import { beforeEach, describe, expect, it, vi } from "vitest";

// Minor B-30: aksi formulir mitra dengan ID rusak tidak pernah menjadi galat server mentah; layanan tidak dipanggil.
const svc = { saveDraft: vi.fn(), upsertNote: vi.fn(), deleteNote: vi.fn(), publish: vi.fn(), assign: vi.fn(), reassign: vi.fn(), declareConflict: vi.fn() };
const deep = { saveDraft: vi.fn(), setDisposition: vi.fn(), setChecklist: vi.fn(), decide: vi.fn(), assign: vi.fn(), reassign: vi.fn() };
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ getSessionRoles: async () => ({ userId: "u1", roles: ["reviewer", "partner_admin"] }) }));
vi.mock("@/lib/reviews/runtime", () => ({ reviewService: () => svc }));
vi.mock("@/lib/deep/runtime", () => ({ deepService: () => deep }));
vi.mock("@/lib/flags", () => ({ flags: { enhancedIssuance: true } }));

import * as review from "@/app/(partner)/partner/actions";
import * as deepActions from "@/app/(partner)/partner/deep-actions";
import { INVALID_FORM_TEXT } from "@/lib/partner/form";

const ID = "00000000-0000-4000-8000-000000000001";
const RV = "00000000-0000-4000-8000-000000000002";
const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const BAD = ["bukan-uuid", "", "../x", "1' or 1=1"];
beforeEach(() => { for (const f of [...Object.values(svc), ...Object.values(deep)]) f.mockReset(); });

describe("aksi Review Standar", () => {
  it("requestId rusak → /partner dengan pemberitahuan INVALID_REQUEST; layanan tidak dipanggil", async () => {
    for (const bad of BAD) {
      for (const fn of [review.saveDraftAction, review.upsertNoteAction, review.deleteNoteAction, review.publishAction, review.declareConflictAction]) {
        await expect(fn(form({ requestId: bad, revision: "1", noteNo: "1", confirm: "yes" }))).rejects.toThrow(/^REDIRECT:\/partner\?e=INVALID_REQUEST$/);
      }
      await expect(review.assignAction(form({ requestId: bad, reviewerId: RV }))).rejects.toThrow(/^REDIRECT:\/partner\?e=INVALID_REQUEST$/);
      await expect(review.reassignAction(form({ requestId: ID, reviewerId: bad }))).rejects.toThrow(/^REDIRECT:\/partner\?e=INVALID_REQUEST$/);
    }
    for (const f of Object.values(svc)) expect(f).not.toHaveBeenCalled();
  });
  it("revisi atau nomor catatan rusak → kembali ke editor dengan pemberitahuan", async () => {
    for (const rev of ["", "abc", "-1", "1.5", "99999999999"]) {
      await expect(review.saveDraftAction(form({ requestId: ID, revision: rev }))).rejects.toThrow(`REDIRECT:/partner/reviews/${ID}?e=INVALID_REQUEST`);
    }
    await expect(review.deleteNoteAction(form({ requestId: ID, revision: "2", noteNo: "0" }))).rejects.toThrow(`REDIRECT:/partner/reviews/${ID}?e=INVALID_REQUEST`);
    expect(svc.saveDraft).not.toHaveBeenCalled();
    expect(svc.deleteNote).not.toHaveBeenCalled();
  });
  it("data valid tetap diteruskan; publish meneruskan pernyataan tanpa konflik", async () => {
    svc.saveDraft.mockResolvedValue(3);
    await expect(review.saveDraftAction(form({ requestId: ID, revision: "2", scope: "Lingkup" }))).rejects.toThrow(`REDIRECT:/partner/reviews/${ID}?ok=draft`);
    expect(svc.saveDraft).toHaveBeenCalledWith("u1", ID, 2, { scope: "Lingkup", assumptions: "", summary: "" });
    svc.publish.mockResolvedValue({ status: "WITHIN_SCOPE" });
    await expect(review.publishAction(form({ requestId: ID, revision: "3", outcome: "WITHIN_SCOPE", attest: "yes", noConflict: "yes" }))).rejects.toThrow(/REDIRECT:/);
    expect(svc.publish.mock.calls[0][2]).toMatchObject({ revision: 3, attest: true, noConflict: true });
  });
  it("pernyataan konflik firma wajib dicentang", async () => {
    await expect(review.declareConflictAction(form({ requestId: ID }))).rejects.toThrow("REDIRECT:/partner?e=CONFLICT_CONFIRM_REQUIRED");
    expect(svc.declareConflict).not.toHaveBeenCalled();
  });
});

describe("aksi Pemeriksaan Mendalam", () => {
  it("deepId/reviewerId rusak → /partner; revisi rusak → editor; layanan tidak dipanggil", async () => {
    for (const bad of BAD) {
      for (const fn of [deepActions.saveDeepDraftAction, deepActions.setDispositionAction, deepActions.setChecklistAction, deepActions.decideDeepAction]) {
        await expect(fn(form({ deepId: bad, revision: "1", noteNo: "1" }))).rejects.toThrow(/^REDIRECT:\/partner\?e=INVALID_REQUEST$/);
      }
      await expect(deepActions.assignDeepAction(form({ deepId: ID, reviewerId: bad }))).rejects.toThrow(/^REDIRECT:\/partner\?e=INVALID_REQUEST$/);
    }
    await expect(deepActions.setDispositionAction(form({ deepId: ID, revision: "1", noteNo: "x" }))).rejects.toThrow(`REDIRECT:/partner/deep/${ID}?e=INVALID_REQUEST`);
    await expect(deepActions.decideDeepAction(form({ deepId: ID, revision: "nan", decision: "DENY" }))).rejects.toThrow(`REDIRECT:/partner/deep/${ID}?e=INVALID_REQUEST`);
    for (const f of Object.values(deep)) expect(f).not.toHaveBeenCalled();
  });
  it("keputusan meneruskan pernyataan tanpa konflik dan nilai flag Enhanced ke layanan", async () => {
    deep.decide.mockResolvedValue({ outcome: "COMPLETED_WITH_NOTES" });
    await expect(deepActions.decideDeepAction(form({ deepId: ID, revision: "4", decision: "DENY", reason: "Belum terpenuhi", attest: "yes", noConflict: "yes" }))).rejects.toThrow(/REDIRECT:/);
    expect(deep.decide).toHaveBeenCalledWith("u1", ID, { revision: 4, decision: "DENY", reason: "Belum terpenuhi", attest: true, noConflict: true, enhancedEnabled: true });
  });
  it("teks pemberitahuan biasa, tanpa istilah teknis", () => {
    expect(INVALID_FORM_TEXT).toBe("Data formulir tidak valid. Muat ulang halaman lalu coba lagi.");
  });
});
