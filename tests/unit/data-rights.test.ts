import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cronAuthError } from "@/lib/jobs/cron-auth";
import { claimDrafts, clearAllDrafts, clearDraft, DRAFT_PREFIX, loadDraft, reconcileDraft, saveDraft, type DraftStorage } from "@/lib/documents/chat-draft";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { OfflineNotice } from "@/components/documents/chat-panel";
import { eraseAccount, ERASE_BLOCK_MESSAGES, type AuthAdmin } from "@/lib/retention/erasure";
import { accountExportHandler } from "@/lib/retention/export";
import { runRetention } from "@/lib/retention/retention";
import { fetchSessionRoles } from "@/lib/supabase/roles";
import type { BlobStore } from "@/lib/documents/blob";

function memStorage(): DraftStorage & { map: Map<string, string>; length: number; key(i: number): string | null } {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
const throwing: DraftStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

describe("draf pesan percakapan (localStorage)", () => {
  it("simpan, muat, hapus per dokumen; teks kosong menghapus draf", () => {
    const s = memStorage();
    expect(saveDraft(s, "d1", "Saya Sinta", 1000)).toBe(true);
    expect(loadDraft(s, "d1", 2000)).toBe("Saya Sinta");
    expect(loadDraft(s, "d2", 2000)).toBeNull();
    saveDraft(s, "d1", "   ", 3000);
    expect(loadDraft(s, "d1", 3000)).toBeNull();
    saveDraft(s, "d1", "lagi", 3000);
    clearDraft(s, "d1");
    expect(s.map.size).toBe(0);
  });

  it("draf lebih dari 7 hari diabaikan dan dibersihkan; isi rusak tidak melempar", () => {
    const s = memStorage();
    saveDraft(s, "d1", "lama", 0);
    expect(loadDraft(s, "d1", 8 * 86_400_000)).toBeNull();
    expect(s.map.size).toBe(0);
    s.setItem(`${DRAFT_PREFIX}d2`, "{bukan json");
    expect(loadDraft(s, "d2", 0)).toBeNull();
  });

  it("penyimpanan yang melempar atau tidak ada tidak pernah merusak halaman", () => {
    expect(saveDraft(throwing, "d1", "x", 0)).toBe(false);
    expect(loadDraft(throwing, "d1", 0)).toBeNull();
    expect(() => clearDraft(throwing, "d1")).not.toThrow();
    expect(saveDraft(null, "d1", "x", 0)).toBe(false);
    expect(loadDraft(undefined, "d1", 0)).toBeNull();
    expect(() => clearAllDrafts(null)).not.toThrow();
  });

  it("rekonsiliasi: terkirim (pesan terakhir sama) → hapus; gagal/dialihkan → kembalikan", () => {
    expect(reconcileDraft(null, "apa saja")).toBe("none");
    expect(reconcileDraft("Saya Sinta ", "Saya Sinta")).toBe("clear");
    expect(reconcileDraft("Saya Sinta", undefined)).toBe("restore");
    expect(reconcileDraft("Saya Sinta", "pesan sebelumnya")).toBe("restore");
  });

  it("clearAllDrafts hanya menghapus kunci draf Yuktanya", () => {
    const s = memStorage();
    saveDraft(s, "d1", "a", 0);
    saveDraft(s, "d2", "b", 0);
    s.setItem("lain", "tetap");
    clearAllDrafts(s);
    expect([...s.map.keys()]).toEqual(["lain"]);
  });

  it("draf milik akun lain di perangkat yang sama dibuang saat akun berbeda membuka percakapan", () => {
    const s = memStorage();
    claimDrafts(s, "user-a");
    saveDraft(s, "d1", "rahasia A", 0);
    claimDrafts(s, "user-a");
    expect(loadDraft(s, "d1", 0)).toBe("rahasia A");
    claimDrafts(s, "user-b");
    expect(loadDraft(s, "d1", 0)).toBeNull();
    expect([...s.map.keys()].filter((k) => k.startsWith(DRAFT_PREFIX))).toEqual([]);
    expect(() => claimDrafts({ ...throwing, length: 1, key: () => { throw new Error("SecurityError"); } }, "user-c")).not.toThrow();
    expect(() => claimDrafts(null, "user-c")).not.toThrow();
  });

  it("clearAllDrafts juga membuang penanda pemilik draf", () => {
    const s = memStorage();
    claimDrafts(s, "user-a");
    saveDraft(s, "d1", "a", 0);
    clearAllDrafts(s);
    expect(s.map.size).toBe(0);
  });

  it("pemberitahuan offline memakai kalimat tetap dan hanya tampil saat offline", () => {
    const on = renderToStaticMarkup(createElement(OfflineNotice, { offline: true }));
    expect(on).toContain("Anda sedang offline. Pesan belum bisa dikirim.");
    expect(on).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(OfflineNotice, { offline: false }))).toBe("");
  });
});

describe("cronAuthError (dipakai bersama job outbox dan retensi)", () => {
  const req = (h?: string) => new Request("http://t/x", { headers: h ? { authorization: h } : {} });
  it("rahasia tidak diset/pendek → 503; header salah → 401; benar → null", async () => {
    expect(cronAuthError(undefined, req("Bearer x"))?.status).toBe(503);
    expect(cronAuthError("pendek", req("Bearer pendek"))?.status).toBe(503);
    expect(cronAuthError("rahasia-panjang-123", req())?.status).toBe(401);
    expect(cronAuthError("rahasia-panjang-123", req("Bearer rahasia-panjang-12"))?.status).toBe(401);
    expect(cronAuthError("rahasia-panjang-123", req("Bearer rahasia-panjang-123"))).toBeNull();
  });
});

describe("runRetention", () => {
  it("mengulang batch selama masih ada sisa, maksimal sejumlah putaran", async () => {
    const calls: unknown[][] = [];
    let left = 3;
    const pool = { query: async (_sql: string, args: unknown[]) => { calls.push(args); left--; return { rows: [{ r: { ai_attempts: 10, ack_challenges: 1, more: left > 0 } }] }; } };
    const r = await runRetention(pool, new Date("2026-10-16T00:00:00Z"), { batch: 10, maxRounds: 5 });
    expect(r).toEqual({ ai_attempts: 30, ack_challenges: 3, rounds: 3, more: false });
    left = 100;
    const r2 = await runRetention(pool, new Date(), { batch: 10, maxRounds: 2 });
    expect(r2).toMatchObject({ rounds: 2, more: true });
  });
});

describe("eraseAccount (orkestrasi)", () => {
  const blob = (fail: string[] = []): BlobStore & { deleted: string[] } => {
    const deleted: string[] = [];
    return { deleted, put: async () => {}, get: async () => null, delete: async (p) => { if (fail.includes(p)) throw new Error("gagal"); deleted.push(p); } };
  };
  const auth = (fail = false): AuthAdmin & { deleted: string[] } => {
    const deleted: string[] = [];
    return { deleted, deleteUser: async (id) => { if (fail) throw new Error("auth down"); deleted.push(id); } };
  };
  const pool = (r: unknown) => ({ query: async () => ({ rows: [{ r }] }) });

  it("ERASED: hapus semua berkas lalu akun Auth; kegagalan berkas dihitung, tidak membatalkan", async () => {
    const b = blob(["b"]);
    const a = auth();
    const r = await eraseAccount({ pool: pool({ status: "ERASED", storage_paths: ["a", "b", "c"] }), blob: b, auth: a }, "u1");
    expect(r).toEqual({ status: "ERASED", filesFailed: 1, authDeleted: true });
    expect(b.deleted).toEqual(["a", "c"]);
    expect(a.deleted).toEqual(["u1"]);
  });

  it("ALREADY_ERASED tetap mencoba menghapus akun Auth (mengulang setelah gagal)", async () => {
    const a = auth();
    expect(await eraseAccount({ pool: pool({ status: "ALREADY_ERASED", storage_paths: [] }), blob: blob(), auth: a }, "u1")).toMatchObject({ status: "ERASED", authDeleted: true });
    const failing = await eraseAccount({ pool: pool({ status: "ERASED", storage_paths: [] }), blob: blob(), auth: auth(true) }, "u1");
    expect(failing).toMatchObject({ status: "ERASED", authDeleted: false });
  });

  it("BLOCKED: tidak menyentuh berkas maupun Auth; setiap alasan punya pesan bahasa sehari-hari", async () => {
    const b = blob();
    const a = auth();
    const r = await eraseAccount({ pool: pool({ status: "BLOCKED", reasons: ["STANDARD_IN_PROGRESS", "PAYMENT_PENDING"] }), blob: b, auth: a }, "u1");
    expect(r).toEqual({ status: "BLOCKED", reasons: ["STANDARD_IN_PROGRESS", "PAYMENT_PENDING"] });
    expect(b.deleted).toEqual([]);
    expect(a.deleted).toEqual([]);
    const keys = ["STAFF_ACCOUNT", "STANDARD_IN_PROGRESS", "DEEP_IN_PROGRESS", "SPECIAL_CASE_OPEN", "PAYMENT_RECONCILIATION", "PAYMENT_PENDING"];
    expect(Object.keys(ERASE_BLOCK_MESSAGES).sort()).toEqual([...keys].sort());
    // Pesan berbeda per alasan dan masing-masing memuat langkah berikutnya yang jelas.
    expect(new Set(keys.map((k) => ERASE_BLOCK_MESSAGES[k])).size).toBe(keys.length);
    for (const k of keys) expect(ERASE_BLOCK_MESSAGES[k]).toMatch(/Tunggu|Hubungi|Tarik|Selesaikan/);
    expect(ERASE_BLOCK_MESSAGES.DEEP_IN_PROGRESS).toMatch(/ditahan/);
  });
});

describe("accountExportHandler", () => {
  const req = new Request("http://app.test/settings/export");
  const deps = (over: Partial<Parameters<typeof accountExportHandler>[0]> = {}) => ({
    getUserId: async () => "u1",
    load: async () => ({ format: "yuktanya-export-v1", user_id: "u1", documents: [] }),
    allow: () => true,
    maxBytes: 1_000_000,
    now: () => new Date("2026-10-16T05:00:00Z"),
    ...over,
  });
  const loc = (r: Response) => new URL(r.headers.get("location")!).pathname + new URL(r.headers.get("location")!).search;
  it("kegagalan tidak pernah menjadi berkas unduhan: dialihkan ke halaman dengan pesan biasa", async () => {
    const anon = await accountExportHandler(deps({ getUserId: async () => null }), req);
    expect(anon.status).toBe(303);
    expect(loc(anon)).toBe("/login?returnTo=%2Fsettings");
    const limited = await accountExportHandler(deps({ allow: () => false }), req);
    expect(limited.status).toBe(303);
    expect(loc(limited)).toBe("/settings?notice=export-limit");
    const big = await accountExportHandler(deps({ maxBytes: 10 }), req);
    expect(loc(big)).toBe("/settings?notice=export-large");
    for (const r of [anon, limited, big]) expect(r.headers.get("content-disposition")).toBeNull();
  });
  it("sukses: unduhan JSON privat bernama tanggal WIB", async () => {
    const res = await accountExportHandler(deps(), req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="data-yuktanya-2026-10-16.json"');
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(await res.text())).toMatchObject({ user_id: "u1" });
  });
});

describe("varian migrasi staging (diterapkan lewat alat MCP)", () => {
  it("tidak memuat literal DROP atau 'delete from' di mana pun, termasuk komentar", () => {
    const dir = path.join(process.cwd(), "supabase/staging");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/\bdrop\b|delete\s+from/i);
    }
  });
});

describe("fetchSessionRoles", () => {
  const client = (rows: unknown[] | null, user: object | null = { id: "u1" }) =>
    ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => ({ select: async () => ({ data: rows, error: null }) }) }) as never;
  it("akun yang sudah dihapus (tanpa peran sama sekali) diperlakukan sebagai tidak masuk", async () => {
    expect(await fetchSessionRoles(client([]))).toBeNull();
    expect(await fetchSessionRoles(client([{ role: "user" }]))).toEqual({ userId: "u1", roles: ["user"] });
    expect(await fetchSessionRoles(client(null, null))).toBeNull();
  });
});
