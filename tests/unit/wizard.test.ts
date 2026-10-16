import { describe, expect, it } from "vitest";
import { buildSteps, nextMissing, progress, summarize } from "@/lib/documents/wizard";
import { nda } from "@/lib/documents/templates/nda";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import type { Data } from "@/lib/documents/types";

const full: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};

describe("buildSteps", () => {
  it("satu langkah per field, berindeks 1..n sesuai urutan", () => {
    const steps = buildSteps(nda);
    expect(steps).toHaveLength(nda.fields.length);
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.every((s) => s.total === nda.fields.length)).toBe(true);
    expect(steps.map((s) => s.field.key)).toEqual(nda.fields.map((f) => f.key));
  });

  it("field uang dan tanggal punya contoh dan penjelasan", () => {
    for (const t of [nda, utangPiutang]) {
      for (const f of t.fields.filter((x) => x.kind === "idr" || x.kind === "date")) {
        expect(f.example).toBeTruthy();
        expect(f.help).toBeTruthy();
      }
    }
  });
});

describe("nextMissing dan progress", () => {
  it("melewati field terisi; null bila semua wajib terisi (opsional kosong boleh)", () => {
    expect(nextMissing(nda, {})?.field.key).toBe("disclosingParty");
    expect(nextMissing(nda, { disclosingParty: "A" })?.field.key).toBe("receivingParty");
    expect(nextMissing(nda, full)).toBeNull();
  });

  it("field wajib hanya spasi dianggap kosong", () => {
    expect(nextMissing(nda, { ...full, purpose: "   " })?.field.key).toBe("purpose");
  });

  it("progress 0% saat kosong, 100% saat lengkap, dan menghitung hanya field wajib", () => {
    expect(progress(nda, {})).toMatchObject({ done: 0, percent: 0 });
    expect(progress(nda, full)).toEqual({ done: 7, total: 7, percent: 100 });
    expect(progress(nda, { disclosingParty: "A", receivingParty: "B" }).percent).toBe(29);
  });
});

describe("summarize", () => {
  it("memformat uang dan tanggal serta menandai field kosong", () => {
    const s = summarize(utangPiutang, {
      creditor: "Rina", debtor: "Agus", signingDate: "2026-10-16", principalIdr: 5000000, dueDate: "2027-01-16", disputeCity: "Surabaya",
    });
    const by = Object.fromEntries(s.map((x) => [x.label, x.value]));
    expect(by["Jumlah pinjaman (rupiah)"]).toBe("Rp5.000.000");
    expect(by["Tanggal surat dibuat"]).toBe("16 Oktober 2026");
    expect(by["Catatan cara pembayaran"]).toBe("(tidak diisi)");
    expect(summarize(utangPiutang, {}).find((x) => x.label === "Nama peminjam")!.value).toBe("(belum diisi)");
  });
});
