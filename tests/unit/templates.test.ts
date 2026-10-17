import { describe, expect, it } from "vitest";
import { nda } from "@/lib/documents/templates/nda";
import { pks } from "@/lib/documents/templates/pks";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import { templateHash, templateHashInput } from "@/lib/documents/templates/base";
import type { Data, Template } from "@/lib/documents/types";
import { renderDocument, renderPartial } from "@/lib/documents/render";

const valid: Record<string, { t: Template; data: Data }> = {
  NDA: {
    t: nda,
    data: {
      disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16",
      confidentialInfo: "Daftar pelanggan sintetis", purpose: "Evaluasi kerja sama", termMonths: 24, disputeCity: "Jakarta Selatan",
    },
  },
  PKS: {
    t: pks,
    data: {
      partyA: "PT Maju Sintetis", partyB: "CV Karya Contoh", signingDate: "2026-10-16", scope: "Pembuatan situs web sintetis",
      startDate: "2026-11-01", endDate: "2027-02-01", valueIdr: 15000000, paymentDueDays: 14, disputeCity: "Bandung",
    },
  },
  UTANG_PIUTANG: {
    t: utangPiutang,
    data: {
      creditor: "Rina Contoh", debtor: "Agus Sintetis", signingDate: "2026-10-16", principalIdr: 5000000,
      dueDate: "2027-01-16", disputeCity: "Surabaya",
    },
  },
};

describe.each(Object.entries(valid))("template %s", (_name, { t, data }) => {
  it("data sintetis valid lolos", () => {
    expect(t.validate(data)).toMatchObject({ ok: true });
  });

  it("setiap field wajib yang kosong atau hanya spasi menghasilkan error pada key-nya", () => {
    for (const f of t.fields.filter((x) => x.required)) {
      for (const blank of ["", "   ", undefined]) {
        const bad = { ...data };
        if (blank === undefined) delete bad[f.key];
        else bad[f.key] = blank;
        const r = t.validate(bad);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(Object.keys(r.errors)).toContain(f.key);
      }
    }
  });

  it("setiap {{key}} di klausul merujuk field yang ada dan clause id unik", () => {
    const keys = new Set(t.fields.map((f) => f.key));
    for (const c of t.clauses) for (const m of c.text.matchAll(/\{\{(\w+)\}\}/g)) expect(keys.has(m[1])).toBe(true);
    for (const c of t.clauses) if (c.whenKey) expect(keys.has(c.whenKey)).toBe(true);
    expect(new Set(t.clauses.map((c) => c.id)).size).toBe(t.clauses.length);
  });

  it("contentHash stabil dan berubah bila satu klausul diubah", () => {
    expect(t.contentHash()).toBe(t.contentHash());
    const changed = { ...t, clauses: t.clauses.map((c, i) => (i === 0 ? { ...c, text: c.text + " " } : c)) };
    expect(templateHash(changed)).not.toBe(t.contentHash());
  });

  it("hash persetujuan mencakup judul, kategori, dan versi aturan render", () => {
    expect(Object.keys(templateHashInput(t)).sort()).toEqual(["category", "clauses", "fields", "id", "renderVersion", "title", "version"]);
    expect(templateHash({ ...t, title: t.title + "!" })).not.toBe(t.contentHash());
    expect(templateHash({ ...t, category: t.category === "NDA" ? "PKS" : "NDA" })).not.toBe(t.contentHash());
  });

  it("kategori, versi, dan status placeholder sintetis tercatat", () => {
    expect(t.version).toBe(1);
    expect(t.id).toMatch(/^[a-z-]+$/);
  });
});

describe("aturan lintas field", () => {
  it("dua pihak bernama sama (beda huruf besar/spasi) ditolak di semua kategori", () => {
    const n = nda.validate({ ...valid.NDA.data, receivingParty: "  SINTA   dewi " });
    expect(n.ok).toBe(false);
    const p = pks.validate({ ...valid.PKS.data, partyB: "pt maju sintetis" });
    expect(p.ok).toBe(false);
    const u = utangPiutang.validate({ ...valid.UTANG_PIUTANG.data, debtor: "RINA CONTOH" });
    expect(u.ok).toBe(false);
  });

  it("utang piutang: pokok ≤ 0 atau desimal atau berupa teks ditolak", () => {
    for (const bad of [0, -5, 1.5, "5000000"]) {
      const r = utangPiutang.validate({ ...valid.UTANG_PIUTANG.data, principalIdr: bad as number });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toHaveProperty("principalIdr");
    }
  });

  it("utang piutang: jatuh tempo harus setelah tanggal perjanjian", () => {
    for (const due of ["2026-10-16", "2026-10-15"]) {
      const r = utangPiutang.validate({ ...valid.UTANG_PIUTANG.data, dueDate: due });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toHaveProperty("dueDate");
    }
  });

  it("PKS: tanggal berakhir harus setelah tanggal mulai; tanggal tidak ada di kalender ditolak", () => {
    const r = pks.validate({ ...valid.PKS.data, endDate: "2026-11-01" });
    expect(r.ok).toBe(false);
    const feb = pks.validate({ ...valid.PKS.data, startDate: "2026-02-31" });
    expect(feb.ok).toBe(false);
  });

  it("karakter kontrol ditolak; baris baru hanya boleh di teks panjang", () => {
    const ctl = nda.validate({ ...valid.NDA.data, disclosingParty: "Sinta\u0001Dewi" });
    expect(ctl.ok).toBe(false);
    const nl = nda.validate({ ...valid.NDA.data, disclosingParty: "Sinta\nDewi" });
    expect(nl.ok).toBe(false);
    const ok = nda.validate({ ...valid.NDA.data, confidentialInfo: "baris satu\r\nbaris dua" });
    expect(ok.ok).toBe(true);
    const nul = nda.validate({ ...valid.NDA.data, confidentialInfo: "a\u0000b" });
    expect(nul.ok).toBe(false);
  });

  it("field di luar skema dibuang dari data hasil validasi dan teks dipangkas", () => {
    const r = nda.validate({ ...valid.NDA.data, disclosingParty: "  Sinta Dewi  ", injected: "x" } as Data);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.disclosingParty).toBe("Sinta Dewi");
      expect(r.data).not.toHaveProperty("injected");
    }
  });
});

// Temuan uji langsung 2026-10-16 (N6): "Pengadilan Negeri Semarang" tersimpan apa adanya → klausul
// "…melalui Pengadilan Negeri Pengadilan Negeri Semarang." pada dokumen yang dinyatakan siap.
describe("kota pengadilan: awalan yang sudah ditulis klausul dibuang, nama kota disimpan", () => {
  const all: [string, Template, Data][] = Object.entries(valid).map(([n, v]) => [n, v.t, v.data]);

  it.each(all)("%s: 'PN Semarang', 'Pengadilan Negeri Semarang', 'pn semarang', 'Kota Semarang' → 'Semarang'", (_n, t, data) => {
    for (const raw of ["PN Semarang", "Pengadilan Negeri Semarang", "pn semarang", "Kota Semarang", "PN. Semarang", "Pengadilan Negeri Kota Semarang", "  Semarang  ", "semarang", "PENGADILAN NEGERI Semarang"]) {
      expect(t.normalize({ disputeCity: raw }).disputeCity).toBe("Semarang");
      const r = t.validate({ ...data, disputeCity: raw });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.disputeCity).toBe("Semarang");
    }
  });

  it.each(all)("%s: nama kota tanpa awalan tetap; nilai yang hanya berisi awalan tidak dikosongkan", (_n, t) => {
    expect(t.normalize({ disputeCity: "Jakarta Selatan" }).disputeCity).toBe("Jakarta Selatan");
    expect(t.normalize({ disputeCity: "Pengadilan Negeri Jakarta Selatan" }).disputeCity).toBe("Jakarta Selatan");
    expect(t.normalize({ disputeCity: "Kotabaru" }).disputeCity).toBe("Kotabaru");
    expect(t.normalize({ disputeCity: "Pengadilan Negeri" }).disputeCity).toBe("Pengadilan Negeri");
    // Kolom lain tidak disentuh.
    const other = t.fields.find((f) => f.kind === "text" && f.key !== "disputeCity")!;
    expect(t.normalize({ [other.key]: "pn semarang" })[other.key]).toBe("pn semarang");
  });

  it.each(all)("%s: dokumen dan pratinjau menulis 'Pengadilan Negeri' tepat satu kali", (_n, t, data) => {
    for (const raw of ["Pengadilan Negeri Semarang", "PN Semarang", "pn semarang", "Kota Semarang", "Semarang"]) {
      const doc = renderDocument(t, { ...data, disputeCity: raw }, "DRAFT");
      const dispute = doc.blocks.find((b) => b.id === "dispute")!.text;
      expect(dispute).toContain("melalui Pengadilan Negeri Semarang.");
      expect(dispute.match(/Pengadilan Negeri/g)).toHaveLength(1);
      const partial = renderPartial(t, { ...data, disputeCity: raw }).find((r) => r.id === "dispute")!.text;
      expect(partial).toContain("melalui Pengadilan Negeri Semarang.");
      expect(partial.match(/Pengadilan Negeri/g)).toHaveLength(1);
    }
  });

  it.each(all)("%s: setiap {{kolom}} yang di klausul didahului 'Pengadilan Negeri' punya daftar awalan", (_n, t) => {
    for (const c of t.clauses) {
      for (const m of c.text.matchAll(/Pengadilan Negeri \{\{(\w+)\}\}/g)) {
        const f = t.fields.find((x) => x.key === m[1])!;
        expect(f.prefixes).toEqual(expect.arrayContaining(["Pengadilan Negeri", "PN", "Kota"]));
        // "Pengadilan" saja tidak boleh dibuang: "Pengadilan Agama X" bukan Pengadilan Negeri.
        expect(f.prefixes).not.toContain("Pengadilan");
      }
    }
  });
});

// Temuan review Task 16: awalan "Kota"/"Pengadilan" yang dibuang sembarangan mengubah nama yang benar.
describe("kota pengadilan: nama yang benar tidak diubah, pengadilan lain ditolak", () => {
  const all: [string, Template, Data][] = Object.entries(valid).map(([n, v]) => [n, v.t, v.data]);

  it.each(all)("%s: nama PN yang memang diawali 'Kota' tetap utuh (Kota Agung, Kota Baru, Kota Bumi)", (_n, t, data) => {
    for (const [raw, want] of [["Kota Agung", "Kota Agung"], ["Pengadilan Negeri Kota Agung", "Kota Agung"], ["PN Kota Baru", "Kota Baru"], ["Kota Bumi", "Kota Bumi"], ["kota agung", "Kota Agung"], ["Kota Mobagu", "Kota Mobagu"], ["Kota Tangerang Selatan", "Tangerang Selatan"], ["PN Jakarta Selatan", "Jakarta Selatan"], ["Kotawaringin Barat", "Kotawaringin Barat"], ["Kotapinang", "Kotapinang"]]) {
      expect(t.normalize({ disputeCity: raw }).disputeCity, raw).toBe(want);
      const r = t.validate({ ...data, disputeCity: raw });
      expect(r.ok, raw).toBe(true);
    }
  });

  it.each(all)("%s: 'Kabupaten'/'Kab.' tidak disentuh", (_n, t, data) => {
    for (const raw of ["Kabupaten Semarang", "Kab. Semarang", "PN Kabupaten Semarang"]) {
      const want = raw.replace(/^PN /, "");
      expect(t.normalize({ disputeCity: raw }).disputeCity).toBe(want);
      expect(t.validate({ ...data, disputeCity: raw }).ok).toBe(true);
    }
  });

  it.each(all)("%s: pengadilan selain Pengadilan Negeri tidak dinormalisasi dan ditolak dengan pesan jelas", (_n, t, data) => {
    const f = t.fields.find((x) => x.key === "disputeCity")!;
    for (const raw of ["Pengadilan Agama Semarang", "Pengadilan Tinggi Semarang", "Pengadilan Niaga Semarang", "Pengadilan Tata Usaha Negara Semarang", "Pengadilan Militer Semarang", "Pengadilan Semarang", "pengadilan agama semarang", "PN Pengadilan Tinggi Semarang"]) {
      expect(t.normalize({ disputeCity: raw }).disputeCity, raw).toBe(raw);
      const r = t.validate({ ...data, disputeCity: raw });
      expect(r.ok, raw).toBe(false);
      if (!r.ok) {
        expect(r.errors.disputeCity).toContain("Pengadilan Negeri");
        expect(r.errors.disputeCity).toContain(f.example!);
      }
    }
  });
});

describe("daftar nama utuh kota pengadilan (fix round 2)", () => {
  it("hanya nama PN yang memang ditulis dua kata: Kota Agung, Kota Baru, Kota Bumi, Kota Mobagu", () => {
    for (const t of Object.values(valid).map((v) => v.t)) {
      expect(t.fields.find((f) => f.key === "disputeCity")!.keepWhole).toEqual(["Kota Agung", "Kota Baru", "Kota Bumi", "Kota Mobagu"]);
    }
  });
});
