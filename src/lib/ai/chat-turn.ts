import { z } from "zod";
import { trackEvent } from "@/lib/analytics/events";
import { findTurnByKey, listMessages, saveAssistantReply, saveUserMessage } from "@/lib/documents/conversation";
import { ForbiddenError } from "@/lib/documents/handlers";
import { StaleRevisionError, type DocumentsService } from "@/lib/documents/service";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import { parseDateId } from "@/lib/documents/format";
import type { Data, FieldSpec, Template } from "@/lib/documents/types";
import { missingRequired } from "@/lib/documents/wizard";
import type { Pool } from "pg";
import type { AttemptLimiter } from "./attempts";
import { GatewayError, type ChatMessage, type chat as gatewayChat } from "./gateway";
import { buildSystemPrompt } from "./chat-prompt";
import { groundSuggestions } from "./grounding";
import { parseInterviewJson } from "./interview";
import { normalizeSpecialCaseTerm, reconcileReply } from "./reply-guard";
import type { UsageStore } from "./quota";

export type ChatTurnDeps = {
  getUserId: () => Promise<string | null>;
  service: DocumentsService;
  store: UsageStore;
  pool: Pool;
  chat: typeof gatewayChat;
  inflight: Set<string>;
  now?: () => Date;
  attempts?: AttemptLimiter;
};

const json = (body: unknown, status = 200, headers?: Record<string, string>) => Response.json(body, { status, headers });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({ message: z.string().trim().min(1).max(2000).optional(), retry: z.boolean().optional() });
const reply = z.object({
  reply: z.string().max(2000).optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});
const HISTORY = 12;
const ASKS_DELETE = /\b(hapus|kosongkan|hilangkan|buang|tidak perlu|tidak usah|tak usah)\b/i;
const isReady = (t: Template, d: Data) => missingRequired(t, d).length === 0 && t.validate(d).ok;
const SAFE_FALLBACK = "Maaf, saya belum menangkap maksud Anda. Bisa ulangi dengan kalimat lain? Pesan ini tidak memakai jatah AI Anda.";

// Usulan model dianggap sudah tercatat bila bentuk bakunya sama dengan nilai akhir (tanggal "16 Oktober 2026" = "2026-10-16").
function sameAsFinal(t: Template, f: FieldSpec, proposed: unknown, final: unknown): boolean {
  if (final === undefined) return false;
  if (String(final) === String(proposed)) return true;
  if (f.kind === "date") {
    try {
      return parseDateId(String(proposed)) === final;
    } catch {
      return false;
    }
  }
  if (f.kind === "idr" || f.kind === "integer") return Number(proposed) === final;
  return t.normalize({ [f.key]: String(proposed).replace(/\s+/g, " ").trim() })[f.key] === final;
}

export async function handleChatTurn(deps: ChatTurnDeps, req: Request, params: { id: string }): Promise<Response> {
  let userId: string | null;
  try {
    userId = await deps.getUserId();
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ code: "FORBIDDEN" }, 403);
    throw e;
  }
  if (!userId) return json({ code: "AUTH_REQUIRED" }, 401);
  if (!UUID.test(params.id)) return json({ code: "NOT_FOUND" }, 404);
  const key = req.headers.get("idempotency-key");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!key || !/^[\x21-\x7e]{8,128}$/.test(key) || !parsed.success || (!parsed.data.message && !parsed.data.retry)) return json({ code: "INVALID_REQUEST" }, 400);

  const doc = await deps.service.get(userId, params.id);
  // Dokumen unggahan tidak memakai wawancara template.
  if (!doc || doc.category === "UPLOAD") return json({ code: "NOT_FOUND" }, 404);
  const template = TEMPLATES[doc.category];

  const existing = await findTurnByKey(deps.pool, userId, params.id, key);
  if (existing?.reply != null) {
    const missing = missingRequired(template, doc.draft.data);
    return json({ reply: existing.reply, applied: [], missing, ready: isReady(template, doc.draft.data), replay: true });
  }

  if (deps.inflight.has(userId)) return json({ code: "AI_BUSY" }, 429, { "retry-after": "2" });
  deps.inflight.add(userId);
  const now = deps.now?.() ?? new Date();
  try {
    if (deps.attempts && !(await deps.attempts.allow(userId, "chat", now))) return json({ code: "TOO_MANY_ATTEMPTS" }, 429, { "retry-after": "60" });

    const history = await listMessages(deps.pool, userId, params.id);
    const lastUnanswered = [...history].reverse().find((m) => m.role === "user" && !m.answered);
    let text = parsed.data.message;
    let reuse = false;
    let readUpTo = 0;
    if (!text || existing) {
      if (!lastUnanswered) return json({ code: "INVALID_REQUEST" }, 400);
      text = lastUnanswered.content;
      reuse = true;
      readUpTo = lastUnanswered.seq;
    }

    const reservation = await deps.store.reserve(userId, "MESSAGE", key, now);
    if (!reservation.ok) {
      const retryAfter = Math.max(1, Math.ceil((new Date(reservation.resetAt).getTime() - now.getTime()) / 1000));
      return json({ code: reservation.code, resetAt: reservation.resetAt }, 429, { "retry-after": String(retryAfter) });
    }
    if (reservation.duplicate) return json({ code: reuse ? "AI_BUSY" : "DUPLICATE_REQUEST" }, reuse ? 429 : 409, reuse ? { "retry-after": "2" } : undefined);

    if (!reuse) readUpTo = (await saveUserMessage(deps.pool, userId, params.id, text, key)).seq;
    const earlier = history.filter((m) => !(reuse && lastUnanswered && m.id === lastUnanswered.id));
    const prior: ChatMessage[] = earlier.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content }));
    const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(template, doc.draft.data) }, ...prior, { role: "user", content: text }];

    // Event analitik best-effort per permintaan logis (grup reservasi): tanpa isi pesan.
    const started = Date.now();
    const aiEvent = (name: "ai_request_started" | "ai_request_succeeded" | "ai_request_failed", errorCode?: string) =>
      trackEvent(deps.pool, {
        name, actorUserId: userId!, entityType: "ai_request", entityId: reservation.groupId, dedupeKey: `${name}:${reservation.groupId}`,
        metadata: { task: "document_chat", ...(name === "ai_request_started" ? {} : { latency_ms: Date.now() - started }), ...(errorCode ? { error_code: errorCode } : {}) },
      });
    await aiEvent("ai_request_started");
    try {
      const first = await deps.chat(messages);
      const result = await parseInterviewJson(reply, first.text, async (rawText, error) =>
        (await deps.chat([...messages, { role: "assistant", content: rawText }, { role: "user", content: `Keluaran tidak valid (${error}). Balas ulang HANYA dengan objek JSON yang benar.` }])).text,
      );
      if (!result.ok) {
        await aiEvent("ai_request_failed", "MALFORMED_OUTPUT");
        await deps.store.release(reservation.groupId);
        await saveAssistantReply(deps.pool, userId, params.id, SAFE_FALLBACK, readUpTo);
        const missing = missingRequired(template, doc.draft.data);
        return json({ reply: SAFE_FALLBACK, applied: [], missing, ready: isReady(template, doc.draft.data), notCharged: true });
      }

      const raw = (result.data.fields ?? {}) as Record<string, unknown>;
      const userText = [...earlier.filter((m) => m.role === "user").map((m) => m.content), text].join("\n");
      const inLatest = groundSuggestions(template, text, raw);
      const inAll = groundSuggestions(template, userText, raw);
      const blank = (k: string) => doc.draft.data[k] === undefined || String(doc.draft.data[k]).trim() === "";
      const grounded: Data = { ...inLatest };
      for (const k of Object.keys(inAll)) if (!(k in grounded) && blank(k)) grounded[k] = inAll[k];
      // Bentuk baku (mis. "Pengadilan Negeri Semarang" → "Semarang") sebelum dibandingkan dan disimpan; tidak menambah nilai.
      const wanted: Data = template.normalize(grounded);
      let applied = Object.keys(wanted).filter((k) => doc.draft.data[k] !== wanted[k]);
      // null = kosongkan kolom: hanya kolom opsional, dan hanya bila pesan terbaru jelas memintanya.
      let cleared = ASKS_DELETE.test(text)
        ? template.fields.filter((f) => !f.required && raw[f.key] === null && !blank(f.key)).map((f) => f.key)
        : [];
      const build = (keep: string[], drop: string[]): Data => {
        const d: Data = { ...doc.draft.data };
        for (const k of keep) d[k] = wanted[k];
        for (const k of drop) delete d[k];
        return d;
      };
      let checked = template.validate(build(applied, cleared));
      const firstErrors = checked.ok ? {} : checked.errors;
      // Pesan validasi kolom yang ditolak (mis. "Pengadilan Agama …" bukan Pengadilan Negeri) ikut disampaikan ke pengguna.
      const fieldIssues = [...new Set(applied.filter((k) => firstErrors[k] && firstErrors[k] !== "Wajib diisi").map((k) => firstErrors[k]))];
      applied = applied.filter((k) => !firstErrors[k] || firstErrors[k] === "Wajib diisi");
      checked = template.validate(build(applied, cleared));
      const errs = checked.ok ? {} : checked.errors;
      // Galat lintas-kolom (mis. tanggal lunas ≤ tanggal surat) ditulis di kolom lain: perubahan yang menimbulkannya ditolak seluruhnya.
      const before = template.validate(doc.draft.data);
      const prior = before.ok ? {} : before.errors;
      const issues = Object.entries(errs).filter(([k, m]) => m !== "Wajib diisi" && prior[k] !== m).map(([, m]) => m);
      if (issues.length > 0) {
        applied = [];
        cleared = [];
      }
      const final = build(applied, cleared);

      if (applied.length > 0 || cleared.length > 0) await deps.service.saveDraft(userId, params.id, final, doc.draft.revision);
      await deps.store.finalize(reservation.groupId, deps.now?.() ?? new Date()).catch(() => undefined);
      await aiEvent("ai_request_succeeded");

      // Nilai yang benar-benar ditulis pengguna (lolos grounding) tapi tidak tersimpan, mis. ditolak validasi: sampaikan jujur.
      // Usulan karangan model yang tidak ada di pesan pengguna dibuang diam-diam (tidak disimpan, tidak dicatat di sini);
      // reconcileReply tetap membuang klaim "saya catat …" atas nilai itu.
      const unnoted = template.fields.filter((f) => f.key in grounded && !cleared.includes(f.key) && !sameAsFinal(template, f, raw[f.key], final[f.key]));
      const note =
        unnoted.length > 0 || issues.length > 0
          ? `Belum tercatat: ${unnoted.map((f) => f.label).join(", ") || "perubahan terakhir"}.${issues.length || fieldIssues.length ? ` ${[...fieldIssues, ...issues].join(" ")}` : " Tulis nilainya lengkap di pesan, sesuai contoh pada pertanyaan."}`
          : "";
      const missing = missingRequired(template, final);
      const said = (result.data.reply ?? "").trim().slice(0, 600);
      // Balasan disesuaikan dengan draf akhir: klaim/pertanyaan yang tidak cocok diganti kalimat dari keadaan server.
      const ready = isReady(template, final);
      const guarded = reconcileReply(said, { template, final, applied, cleared, ready, userText, noted: note !== "", notedKeys: unnoted.map((f) => f.key) });
      // Istilah glosarium untuk rute penilaian khusus ("kasus khusus" bebas dari model → Kasus Hukum Khusus (Special Legal Case)).
      const out = [normalizeSpecialCaseTerm(guarded), note].filter(Boolean).join("\n\n").slice(0, 4000);
      await saveAssistantReply(deps.pool, userId, params.id, out, readUpTo);
      return json({ reply: out, applied: [...applied, ...cleared], missing, ready, issues });
    } catch (e) {
      await deps.store.release(reservation.groupId).catch(() => undefined);
      if (e instanceof StaleRevisionError) {
        await aiEvent("ai_request_failed", "STALE_REVISION");
        return json({ code: "STALE_REVISION" }, 409);
      }
      if (e instanceof GatewayError) {
        await aiEvent("ai_request_failed", e.code);
        return json({ code: "AI_UNAVAILABLE", preserved: true }, 502);
      }
      await aiEvent("ai_request_failed", "INTERNAL");
      return json({ code: "INTERNAL" }, 500);
    }
  } finally {
    deps.inflight.delete(userId);
  }
}
