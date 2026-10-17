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
import type { InflightGuard } from "./inflight";
import { GatewayError, type ChatMessage, type chat as gatewayChat } from "./gateway";
import { buildSystemPrompt } from "./chat-prompt";
import { groundSuggestions } from "./grounding";
import { FIELD_CUES, normalizeSpecialCaseTerm, reconcileReply } from "./reply-guard";
import type { UsageStore } from "./quota";
import { chatJsonWithinDeadline, turnDeadline } from "./turn";

export type ChatTurnDeps = {
  getUserId: () => Promise<string | null>;
  service: DocumentsService;
  store: UsageStore;
  pool: Pool;
  chat: typeof gatewayChat;
  inflight: InflightGuard;
  now?: () => Date;
  // Jam dinding untuk tenggat giliran (Task 24); hanya diganti dalam uji.
  clock?: () => number;
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

// Grounding hanya membaca angka. Jumlah yang ditulis dengan kata ("lima juta", "sejuta", "lima ratus ribu", "enam bulan")
// berarti pengguna memang menyebut nilai, jadi usulan model untuk kolom angka itu dilaporkan "Belum tercatat" + petunjuk.
const NUM_WORD = "(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|puluh|belas|ratus)";
const SPELLED_MONEY = new RegExp(`\\b(?:se(?:ratus|ribu|juta|miliar|triliun)|${NUM_WORD}\\s+(?:ratus|ribu|juta|miliar|triliun))\\b`, "i");
const MONEY_CUE = /\b(rp|rupiah|uang|pinjam\w*|pinjem\w*|minjam\w*|meminjam\w*|utang|hutang|nilai\w*|harga|biaya|bayar\w*|jumlah\w*|sebesar|senilai)\b/i;
const spelledCount = (unit: string) => new RegExp(`\\b${NUM_WORD}(?:\\s+${NUM_WORD})*\\s+${unit}\\b`, "i");
function spelledNumber(t: Template, f: FieldSpec, text: string): boolean {
  if (f.kind === "idr") return SPELLED_MONEY.test(text) && (MONEY_CUE.test(text) || !!FIELD_CUES[t.id]?.[f.key]?.test(text));
  if (f.kind === "integer") return spelledCount(/bulan/i.test(f.label) ? "bulan" : /hari/i.test(f.label) ? "hari" : "(?:bulan|hari)").test(text);
  return false;
}
const exampleOf = (f: FieldSpec, fallback: string) => f.example?.replace(/^Contoh:\s*/i, "").trim() || fallback;
const spelledHint = (f: FieldSpec) =>
  f.kind === "idr" ? `Tulis jumlahnya dengan angka, misalnya ${exampleOf(f, "Rp5.000.000")}.` : `Tulis angkanya, misalnya ${exampleOf(f, "12")}.`;
const KASUS_KHUSUS = /kasus\s+khusus/i;

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
  const clock = deps.clock ?? Date.now;
  const deadline = turnDeadline(clock);
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

  const lease = await deps.inflight.acquire(userId);
  if (!lease) return json({ code: "AI_BUSY" }, 429, { "retry-after": "2" });
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
      const result = await chatJsonWithinDeadline(deps.chat, reply, messages, deadline, clock);
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
      // Jumlah yang ditulis dengan kata di pesan terbaru juga dilaporkan, dengan petunjuk menulis angka.
      // Usulan karangan model yang tidak ada di pesan pengguna dibuang diam-diam (tidak disimpan, tidak dicatat di sini);
      // reconcileReply tetap membuang klaim "saya catat …" atas nilai itu.
      const proposed = (f: FieldSpec) => raw[f.key] != null && String(raw[f.key]).trim() !== "" && !cleared.includes(f.key) && !sameAsFinal(template, f, raw[f.key], final[f.key]);
      const spelled = template.fields.filter((f) => !(f.key in grounded) && proposed(f) && spelledNumber(template, f, text));
      const unnoted = template.fields.filter((f) => (f.key in grounded && proposed(f)) || spelled.includes(f));
      const hints = [...new Set([...fieldIssues, ...issues, ...spelled.map(spelledHint)])];
      const note =
        unnoted.length > 0 || issues.length > 0
          ? `Belum tercatat: ${unnoted.map((f) => f.label).join(", ") || "perubahan terakhir"}.${hints.length ? ` ${hints.join(" ")}` : " Tulis nilainya lengkap di pesan, sesuai contoh pada pertanyaan."}`
          : "";
      const missing = missingRequired(template, final);
      // Istilah glosarium untuk teks bebas model ("kasus khusus" → Kasus Hukum Khusus (Special Legal Case)), kecuali bila
      // pesan pengguna atau draf memuat frasa itu sebagai nilai (mis. "menangani kasus khusus pelanggan"). Hanya teks model
      // yang dinormalkan, sebelum penyesuaian; baris server ("Yang tercatat dari pesan ini: …") tidak pernah diubah.
      const echoes = KASUS_KHUSUS.test(text) || Object.values(final).some((v) => typeof v === "string" && KASUS_KHUSUS.test(v));
      const modelText = (result.data.reply ?? "").trim().slice(0, 600);
      const said = echoes ? modelText : normalizeSpecialCaseTerm(modelText);
      // Balasan disesuaikan dengan draf akhir: klaim/pertanyaan yang tidak cocok diganti kalimat dari keadaan server.
      const ready = isReady(template, final);
      const guarded = reconcileReply(said, { template, final, applied, cleared, ready, userText, noted: note !== "", notedKeys: unnoted.map((f) => f.key) });
      const out = [guarded, note].filter(Boolean).join("\n\n").slice(0, 4000);
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
        // Tenggat giliran habis / gateway timeout: pesan "AI sedang lambat"; pesan pengguna tetap tersimpan, kuota dilepas.
        if (e.code === "TIMEOUT") return json({ code: "AI_TIMEOUT", preserved: true }, 504);
        return json({ code: "AI_UNAVAILABLE", preserved: true }, 502);
      }
      await aiEvent("ai_request_failed", "INTERNAL");
      return json({ code: "INTERNAL" }, 500);
    }
  } finally {
    await deps.inflight.release(userId, lease);
  }
}
