import { describe, expect, it } from "vitest";
import { CORRECTION_LINE, FIELD_CUES, normalizeSpecialCaseTerm, READY_LINE, reconcileReply, sanitizeReply, type ReplyState } from "@/lib/ai/reply-guard";
import { nda } from "@/lib/documents/templates/nda";
import { pks } from "@/lib/documents/templates/pks";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import type { Data, Template } from "@/lib/documents/types";

// Balasan model di bawah disalin dari transkrip uji langsung 2026-10-16 (data sintetis); "/" di transkrip = baris baru.
const ALL_KEYS = Object.values(TEMPLATES).flatMap((t) => t.fields.map((f) => f.key));
const KEY_RE = new RegExp(`\\b(${ALL_KEYS.join("|")})\\b`);
const ISO_RE = /\d{4}-\d{2}-\d{2}|YYYY|MM-DD/i;

const state = (template: Template, final: Data, userText: string, o: Partial<ReplyState> = {}): ReplyState => {
  const blank = (k: string) => final[k] === undefined || String(final[k]).trim() === "";
  const ready = template.fields.every((f) => !f.required || !blank(f.key)) && template.validate(final).ok;
  return { template, final, applied: Object.keys(final), cleared: [], ready, userText, noted: false, ...o };
};

describe("sanitizeReply: tanpa nama kolom internal dan format tanggal mesin", () => {
  it("N5: nama kolom diganti label, tanggal ISO ditulis seperti 21 Oktober 2026", () => {
    const out = sanitizeReply(nda, "Terima kasih, saya telah mencatat data yang Anda berikan: disclosingParty Andi Saputra, receivingParty Bayu Pratama, signingDate 2026-10-21, confidentialInfo rencana pemasaran, purpose menilai kerja sama promosi, termMonths 12, disputeCity Jakarta Selatan.");
    expect(out).not.toMatch(KEY_RE);
    expect(out).not.toMatch(ISO_RE);
    expect(out).toContain("21 Oktober 2026");
    expect(out).toContain("nama pihak yang membagikan informasi rahasia Andi Saputra");
  });

  it("P5: '(partyA)' dalam kurung dihapus", () => {
    expect(sanitizeReply(pks, "Siapa nama pihak pertama (partyA)? Contoh: PT Maju Bersama.")).toBe("Siapa nama pihak pertama? Contoh: PT Maju Bersama.");
  });

  it("N7/P3/N8: 'format YYYY-MM-DD' hilang dan contoh tanggal ditulis dengan nama bulan", () => {
    expect(sanitizeReply(nda, "Berapa tanggal perjanjian dibuat (format YYYY-MM-DD, contoh: 2026-10-16)?")).toBe("Berapa tanggal perjanjian dibuat (contoh: 16 Oktober 2026)?");
    expect(sanitizeReply(pks, "Kapan perjanjian ini dibuat (tanggal dibuatnya, contoh: 2026-10-16)?")).toBe("Kapan perjanjian ini dibuat (tanggal dibuatnya, contoh: 16 Oktober 2026)?");
    expect(sanitizeReply(nda, "Tulis tanggal dengan format YYYY-MM-DD.")).not.toMatch(ISO_RE);
    expect(sanitizeReply(nda, "Tanggal (format yyyy/mm/dd) berapa?")).not.toMatch(/yyyy/i);
  });

  it("U1: 'creditor'/'debtor' dan 'per 2027-01-16' ikut dibersihkan", () => {
    const out = sanitizeReply(utangPiutang, "Terima kasih, saya mengerti Anda adalah creditor (Rina Wulandari) dan Agus Prasetyo adalah debtor. Pinjaman sebesar Rp5.000.000 harus dibayar per 2027-01-16.");
    expect(out).not.toMatch(KEY_RE);
    expect(out).toContain("16 Januari 2027");
  });

  it("teks biasa tidak berubah", () => {
    const s = "Baik, saya catat pinjaman dari Putri Anggraini sebesar Rp500.000.";
    expect(sanitizeReply(utangPiutang, s)).toBe(s);
  });
});

describe("reconcileReply: balasan mengikuti apa yang benar-benar tersimpan", () => {
  it("N4: klaim mencatat Hendra Gunawan padahal tidak tersimpan → diganti daftar yang tersimpan; pertanyaan kolom kosong tetap", () => {
    const said = "Baik, saya catat Hendra Gunawan sebagai pihak yang membagikan informasi dan Lina Marlina sebagai penerima. Siapa nama pihak yang membagikan informasi rahasia? (Contoh: Sinta Dewi)";
    const out = reconcileReply(said, state(nda, { receivingParty: "Lina Marlina" }, "Saya Hendra Gunawan merahasiakan data penjualan toko dari Lina Marlina."));
    expect(out).not.toContain("saya catat Hendra Gunawan");
    expect(out).toContain("Nama pihak yang menerima informasi rahasia: Lina Marlina");
    expect(out).toContain("Siapa nama pihak yang membagikan informasi rahasia? (Contoh: Sinta Dewi)");
  });

  it("U2: klaim 'dari Budi' padahal pemberi pinjaman kosong → diganti; yang tersimpan (Rp5.000.000) disebut", () => {
    const said = "Baik, saya catat pinjaman Rp5.000.000 dari Budi. Siapa nama lengkap Anda (peminjam)? Contoh: Agus Prasetyo. Dan siapa nama lengkap pemberi pinjaman (kreditur)? Contoh: Rina Wulandari.";
    const out = reconcileReply(said, state(utangPiutang, { principalIdr: 5000000 }, "pinjem 5 jt dari budi, balikin 3 bulan lagi"));
    expect(out).not.toMatch(/catat[^.]*Budi/);
    expect(out).toContain("Jumlah pinjaman (rupiah): Rp5.000.000");
    expect(out).toContain("Siapa nama lengkap Anda (peminjam)? Contoh: Agus Prasetyo.");
    expect(out).toContain("pemberi pinjaman (kreditur)? Contoh: Rina Wulandari.");
  });

  it("U4: dokumen siap tapi model menanyakan kota dan tanggal yang sudah terisi → pertanyaan dibuang, dinyatakan lengkap", () => {
    const final = { signingDate: "2026-10-17", creditor: "Putri Anggraini", debtor: "Oki Firmansyah", principalIdr: 500000, dueDate: "2026-12-17", disputeCity: "Malang" };
    const said = "Baik, saya catat pinjaman dari Putri Anggraini sebesar Rp500.000. Di kota mana pengadilan bila terjadi sengketa (contoh: Surabaya)? Tanggal berapa surat dibuat (contoh: 16 Oktober 2026)?";
    const out = reconcileReply(said, state(utangPiutang, final, "Saya Oki Firmansyah pinjam 500 ribu dari Putri Anggraini. Suratnya tanggal 17 Oktober 2026, saya lunasi 17 Desember 2026. Sengketa di Pengadilan Negeri Malang."));
    expect(out).toContain("Baik, saya catat pinjaman dari Putri Anggraini sebesar Rp500.000.");
    expect(out).not.toMatch(/kota mana|Tanggal berapa/);
    expect(out).toContain("Semua kolom wajib sudah terisi");
  });

  it("U8: pertanyaan kota yang sudah terisi beserta contohnya dibuang", () => {
    const final = { signingDate: "2026-10-16", creditor: "Wawan Setiawan", debtor: "Yuni Astuti", principalIdr: 1500000, dueDate: "2027-01-16", disputeCity: "Bekasi" };
    const said = "Baik, saya catat Wawan Setiawan sebagai pemberi pinjaman, Yuni Astuti sebagai peminjam, jumlah Rp1.500.000, tanggal 16 Oktober 2026, jatuh tempo 16 Januari 2027, dan sengketa di Bekasi.\nBolehkah saya tahu kota pengadilan bila terjadi sengketa? Contoh: Surabaya.";
    const out = reconcileReply(said, state(utangPiutang, final, "Wawan Setiawan meminjamkan Rp1.500.000 kepada Yuni Astuti. Surat dibuat 16/10/2026 dan harus lunas 16/01/2027. Pengadilan Negeri Bekasi."));
    expect(out).toContain("dan sengketa di Bekasi.");
    expect(out).not.toMatch(/Bolehkah|Surabaya/);
  });

  it("N3: pertanyaan 'informasi rahasia apa' saat kolom itu sudah terisi dibuang; pertanyaan tujuan tetap", () => {
    const final = { signingDate: "2026-10-18", disclosingParty: "Dewi Lestari", receivingParty: "Agus Wijaya", confidentialInfo: "desain logo baru", termMonths: 6 };
    const said = "Baik, saya catat Dewi Lestari sebagai pihak yang membagikan informasi dan Agus Wijaya sebagai penerima untuk jangka waktu 6 bulan pada tanggal 18 Oktober 2026. Apa informasi rahasia yang dibagikan (contoh: daftar pelanggan dan harga modal)? Dan untuk apa informasi itu boleh dipakai (contoh: menilai rencana kerja sama)?";
    const out = reconcileReply(said, state(nda, final, "Saya Dewi Lestari mau merahasiakan desain logo baru dari Agus Wijaya selama 6 bulan, tanggal 18 Oktober 2026."));
    expect(out).toContain("Baik, saya catat Dewi Lestari");
    expect(out).not.toContain("Apa informasi rahasia yang dibagikan");
    expect(out).toContain("untuk apa informasi itu boleh dipakai");
  });

  it("N5: klaim yang memuat nama kolom diganti daftar berlabel dengan tanggal Indonesia", () => {
    const final = { signingDate: "2026-10-21", disclosingParty: "Andi Saputra", receivingParty: "Joko Prasetyo", confidentialInfo: "rencana pemasaran", purpose: "menilai kerja sama promosi", termMonths: 18, disputeCity: "Jakarta Selatan" };
    const out = reconcileReply("Sudah saya perbarui, receivingParty sekarang Joko Prasetyo dan termMonths 18. Semua data lain tetap sama. Dokumen siap, boleh koreksi lagi.", state(nda, final, "Jangka waktunya ubah jadi 18 bulan ya.", { applied: ["termMonths"] }));
    expect(out).not.toMatch(KEY_RE);
    expect(out).toContain("Berapa bulan kerahasiaan berlaku: 18");
    expect(out).toContain("Dokumen siap, boleh koreksi lagi.");
  });

  it("klaim tanggal yang ditolak validasi lintas kolom tidak dibiarkan; catatan server cukup", () => {
    const final = { creditor: "Rina Wulandari", debtor: "Agus Prasetyo", signingDate: "2026-10-16", principalIdr: 5000000, dueDate: "2027-01-16", disputeCity: "Surabaya" };
    const out = reconcileReply("Baik, tanggal surat 1 Februari 2027 dicatat.", state(utangPiutang, final, "tanggal surat 1 Februari 2027", { applied: [], noted: true }));
    expect(out).not.toContain("1 Februari 2027 dicatat");
  });

  it("model mengaku dokumen siap padahal belum → kalimat itu dibuang dan kolom kosong ditanyakan", () => {
    const out = reconcileReply("Semua data sudah lengkap, dokumen siap dibuat!", state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi", { applied: ["disclosingParty"] }));
    expect(out).not.toMatch(/siap dibuat|sudah lengkap/);
    expect(out).toContain("Nama pihak yang menerima informasi rahasia?");
  });

  it("P5: klaim pasangan nama yang tidak tersimpan diganti; pertanyaan dengan (partyA) dibersihkan", () => {
    const said = "Halo Kak Gilang! Saya catat kerja sama katering antara Gilang Ramadhan dan Hana Pertiwi senilai Rp20.000.000 mulai 1 November 2026. Siapa nama pihak pertama (partyA)? Contoh: PT Maju Bersama. Siapa nama pihak kedua (partyB)? Contoh: CV Karya Mandiri.";
    const final = { scope: "usaha katering", startDate: "2026-11-01", valueIdr: 20000000 };
    const out = reconcileReply(said, state(pks, final, "Saya Gilang Ramadhan dan Hana Pertiwi mau kerja sama usaha katering selama setahun mulai 1 November 2026, nilai Rp20.000.000."));
    expect(out).not.toMatch(KEY_RE);
    expect(out).not.toMatch(/catat[^.]*Gilang Ramadhan/);
    expect(out).toContain("Tanggal kerja sama mulai: 1 November 2026");
    expect(out).toContain("Nilai kerja sama (rupiah): Rp20.000.000");
    expect(out).toContain("Siapa nama pihak pertama? Contoh: PT Maju Bersama.");
  });

  it("balasan yang konsisten dibiarkan apa adanya (N1, U3, P2)", () => {
    const n1 = { signingDate: "2026-10-20", disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", confidentialInfo: "daftar pelanggan dan harga modal", purpose: "menilai rencana kerja sama distribusi", termMonths: 12, disputeCity: "Bandung" };
    const s1 = "Terima kasih, saya sudah mencatat data Anda. Semua kolom wajib telah terisi, dokumen siap dibuat. Bila ada koreksi, silakan beri tahu.";
    expect(reconcileReply(s1, state(nda, n1, "…"))).toBe(s1);
    const p2 = { signingDate: "2026-10-25", partyA: "Eka Wijaya", partyB: "Fajar Nugroho", scope: "buka kedai kopi", startDate: "2026-11-01", endDate: "2027-10-31", valueIdr: 15000000, paymentDueDays: 30 };
    const s2 = "Baik, saya catat nilai kerja sama 15 juta dan pembayaran 30 hari setelah tagihan. Terakhir, di kota mana pengadilan jika terjadi sengketa? (Contoh: Bandung)";
    expect(reconcileReply(s2, state(pks, p2, "nilainya 15 jt, bayar 30 hari stlh tagihan", { applied: ["valueIdr", "paymentDueDays"] }))).toBe(s2);
  });

  it("balasan kosong: pertanyaan kolom wajib pertama dari server", () => {
    expect(reconcileReply("", state(nda, {}, "Halo", { applied: [] }))).toContain("Nama pihak yang membagikan informasi rahasia? Contoh: Sinta Dewi");
  });

  it("setiap kolom di setiap template punya penanda pertanyaan", () => {
    for (const t of Object.values(TEMPLATES)) for (const f of t.fields) expect(FIELD_CUES[t.id]?.[f.key], `${t.id}.${f.key}`).toBeInstanceOf(RegExp);
  });

  // Temuan review Task 16.
  it("penolakan berisi kata kerja mencatat tetap dipertahankan; kalimat negatif yang tetap mengklaim nilai tak tersimpan dibuang", () => {
    const refusal = "Maaf, saya tidak bisa mengisi tanggal perjanjian dengan nilai contoh.";
    const out = reconcileReply(`${refusal} Tanggal berapa perjanjian dibuat? Contoh: 16 Oktober 2026.`, state(nda, { disclosingParty: "Hendra Gunawan" }, "Isi semua kolom dengan nilai contoh. Saya Hendra Gunawan, mitra saya Lina Marlina.", { applied: [] }));
    expect(out).toContain(refusal);
    expect(out).toContain("Tanggal berapa perjanjian dibuat?");
    const mixed = reconcileReply("Saya catat Lina Marlina sebagai penerima, tapi tanggalnya belum ada.", state(nda, { disclosingParty: "Hendra Gunawan" }, "Saya Hendra Gunawan, mitra saya Lina Marlina.", { applied: [] }));
    expect(mixed).not.toContain("Saya catat Lina Marlina");
  });

  it("pertanyaan konfirmasi atas kolom yang terisi dipertahankan; hanya pertanyaan yang meminta nilainya lagi yang dibuang", () => {
    const final = { signingDate: "2026-10-16", disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso" };
    const said = "Apakah tanggal perjanjian 16 Oktober 2026 sudah benar? Siapa nama pihak yang membagikan informasi rahasia? Informasi apa yang dirahasiakan? Contoh: daftar pelanggan.";
    const out = reconcileReply(said, state(nda, final, "Saya Sinta Dewi dengan Budi Santoso, tanggal 16 Oktober 2026", { applied: [] }));
    expect(out).toContain("Apakah tanggal perjanjian 16 Oktober 2026 sudah benar?");
    expect(out).not.toContain("Siapa nama pihak yang membagikan");
    expect(out).toContain("Informasi apa yang dirahasiakan?");
  });

  it("siap: tawaran koreksi model dipertahankan; bila tidak ada, server menambahkannya", () => {
    const n1 = { signingDate: "2026-10-20", disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", confidentialInfo: "daftar pelanggan", purpose: "menilai kerja sama", termMonths: 12, disputeCity: "Bandung" };
    const offer = "Baik, semua data sudah lengkap. Ada yang ingin dikoreksi sebelum dokumen dibuat?";
    expect(reconcileReply(offer, state(nda, n1, "…", { applied: [] }))).toBe(offer);
    const plain = reconcileReply("Baik, semua data sudah lengkap.", state(nda, n1, "…", { applied: [] }));
    expect(plain).toContain(CORRECTION_LINE);
    expect(CORRECTION_LINE).toBe("Jika ada yang perlu dikoreksi, sebutkan saja.");
    // Tawaran koreksi tidak ditambahkan saat belum siap.
    expect(reconcileReply("Baik.", state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi", { applied: [] }))).not.toContain(CORRECTION_LINE);
  });

  // Re-review fix round 1.
  const fullNda = { signingDate: "2026-10-16", disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", confidentialInfo: "daftar pelanggan", purpose: "menilai kerja sama", termMonths: 12, disputeCity: "Bandung" };
  it("kalimat 'siap/lengkap' dengan kata negasi yang tidak menegasikan kesiapan dibuang bila belum siap, dipertahankan bila siap", () => {
    for (const probe of ["Semua data sudah lengkap, tidak ada yang kurang.", "Dokumen sudah siap dibuat dan tidak perlu diubah lagi."]) {
      expect(reconcileReply(probe, state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi", { applied: [] })), probe).not.toContain(probe);
      expect(reconcileReply(probe, state(nda, fullNda, "…", { applied: [] })), probe).toContain(probe);
    }
  });

  it("kesiapan yang benar-benar dinegasikan ('belum lengkap', 'belum siap') dipertahankan hanya bila memang belum siap", () => {
    for (const probe of ["Data Anda belum lengkap.", "Dokumen belum siap dibuat."]) {
      expect(reconcileReply(probe, state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi", { applied: [] })), probe).toContain(probe);
      expect(reconcileReply(probe, state(nda, fullNda, "…", { applied: [] })), probe).not.toContain(probe);
    }
  });

  it("pertanyaan konfirmasi yang mengklaim nilai tak tersimpan atau menyebut nama yang tidak pernah ditulis dibuang", () => {
    const s0 = state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi mau bikin NDA.", { applied: [] });
    expect(reconcileReply("Sudah saya catat Budi Santoso sebagai penerima, benar?", s0)).not.toContain("catat Budi Santoso");
    expect(reconcileReply("Apakah benar penerima bernama Joko Widodo?", s0)).not.toContain("Joko Widodo");
    // Nama yang ditulis pengguna tapi belum tersimpan boleh dikonfirmasi.
    const s1 = state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi, penerimanya Budi Santoso.", { applied: [] });
    expect(reconcileReply("Apakah benar penerima bernama Budi Santoso?", s1)).toContain("Apakah benar penerima bernama Budi Santoso?");
    // Konfirmasi atas tanggal yang tersimpan tetap; tanggal yang tidak tersimpan dan tidak ditulis dibuang.
    const s2 = state(nda, { signingDate: "2026-10-16", disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi, tanggal 16 Oktober 2026", { applied: [] });
    expect(reconcileReply("Apakah tanggal perjanjian 16 Oktober 2026 sudah benar?", s2)).toContain("Apakah tanggal perjanjian 16 Oktober 2026 sudah benar?");
    expect(reconcileReply("Apakah tanggal perjanjian 20 Oktober 2026 sudah benar?", s2)).not.toContain("20 Oktober 2026");
    // Tawaran koreksi umum tetap.
    expect(reconcileReply("Ada yang ingin dikoreksi?", state(nda, fullNda, "…", { applied: [] }))).toContain("Ada yang ingin dikoreksi?");
  });
});

// Task 22 (A01): kalimat model "Tersisa: …" / "tinggal … yang masih kosong" tidak boleh bertentangan dengan READY_LINE.
describe("reconcileReply: pernyataan sisa kolom mengikuti draf akhir", () => {
  const fullUtang = { creditor: "Rina Wulandari", debtor: "Agus Prasetyo", signingDate: "2026-10-16", principalIdr: 5000000, dueDate: "2027-01-16", disputeCity: "Surabaya" };
  const userUtang = "Saya Rina Wulandari meminjamkan Rp5.000.000 kepada Agus Prasetyo, surat 16 Oktober 2026, lunas 16 Januari 2027, pengadilan Surabaya.";

  it("probe: siap → 'Tersisa: catatan cara pembayaran' dibuang, konfirmasi tetap, READY_LINE tetap", () => {
    const out = reconcileReply("Baik, saya catat jatuh tempo. Tersisa: catatan cara pembayaran.", state(utangPiutang, fullUtang, userUtang, { applied: ["dueDate"] }));
    expect(out).not.toMatch(/Tersisa/i);
    expect(out).toContain("Baik, saya catat jatuh tempo.");
    expect(out).toContain(READY_LINE);
  });

  it("probe: siap → '… tinggal kota pengadilan yang masih kosong' dibuang", () => {
    for (const said of ["Baik, saya catat. Tinggal kota pengadilan yang masih kosong.", "Baik, saya catat tanggal lunas, tinggal kota pengadilan yang masih kosong.", "Baik, saya catat. Tersisa: kota pengadilan."]) {
      const out = reconcileReply(said, state(utangPiutang, fullUtang, userUtang, { applied: ["dueDate"] }));
      expect(out, said).not.toMatch(/tinggal|masih kosong|Tersisa/i);
      expect(out, said).toContain(READY_LINE);
    }
  });

  it("belum siap: sisa kolom yang memang masih kosong dipertahankan", () => {
    const final = { creditor: "Rina Wulandari", debtor: "Agus Prasetyo", signingDate: "2026-10-16", principalIdr: 5000000 };
    for (const said of ["Tersisa: tanggal pinjaman harus lunas dan kota pengadilan.", "Tinggal kota pengadilan yang masih kosong.", "Kota pengadilan belum diisi."]) {
      const out = reconcileReply(`Baik, saya catat. ${said}`, state(utangPiutang, final, userUtang, { applied: ["principalIdr"] }));
      expect(out, said).toContain(said);
      expect(out, said).not.toContain(READY_LINE);
    }
  });

  it("belum siap: kalimat yang menyebut kolom yang sudah terisi (atau kolom opsional) sebagai sisa dibuang", () => {
    const final = { creditor: "Rina Wulandari", debtor: "Agus Prasetyo", signingDate: "2026-10-16", principalIdr: 5000000 };
    for (const said of ["Tersisa: jumlah pinjaman dan kota pengadilan.", "Tanggal surat dibuat masih kosong.", "Nama peminjam belum terisi.", "Tersisa: catatan cara pembayaran."]) {
      const out = reconcileReply(`Baik. ${said}`, state(utangPiutang, final, userUtang, { applied: [] }));
      expect(out, said).not.toContain(said);
      // Server tetap menanyakan kolom wajib yang masih kosong.
      expect(out, said).toContain("Tanggal pinjaman harus lunas?");
    }
  });

  it("belum siap: pernyataan sisa tanpa kolom spesifik dipertahankan", () => {
    const out = reconcileReply("Baik. Masih ada data yang kosong.", state(utangPiutang, { creditor: "Rina Wulandari" }, "Saya Rina Wulandari", { applied: [] }));
    expect(out).toContain("Masih ada data yang kosong.");
  });

  it("kalimat biasa tanpa isyarat sisa tidak tersentuh (siap maupun belum)", () => {
    const ok = [
      "Baik, saya catat Budi Santoso yang tinggal di Bandung sebagai penerima.",
      "Anda tinggal memeriksa ringkasan, lalu menekan tombol Buat dokumen.",
      "Bila masih perlu koreksi, sebutkan saja.",
      "Tidak ada yang kurang.",
      "Catatan tambahan boleh dikosongkan.",
      "Maaf, saya tidak bisa memberikan nasihat hukum.",
    ];
    const ready = { signingDate: "2026-10-16", disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", confidentialInfo: "daftar pelanggan", purpose: "menilai kerja sama", termMonths: 12, disputeCity: "Bandung" };
    for (const s of ok) expect(reconcileReply(s, state(nda, ready, "Saya Sinta Dewi, penerimanya Budi Santoso yang tinggal di Bandung.", { applied: [] })), s).toContain(s);
    expect(reconcileReply(ok[5], state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi", { applied: [] }))).toContain(ok[5]);
  });

  // Fix round 1 (I2): ungkapan sisa yang umum juga dibuang saat siap.
  it("siap: ungkapan sisa lain ('Yang belum: …', 'satu lagi', 'perlu diisi', 'belum Anda sebutkan') dibuang", () => {
    for (const said of [
      "Yang belum: kota pengadilan.",
      "Masih ada satu lagi, yaitu kota pengadilan.",
      "Kolom yang perlu diisi: kota pengadilan.",
      "Satu lagi yang dibutuhkan: kota pengadilan.",
      "Yang masih harus diisi adalah kota pengadilan.",
      "Kota pengadilan belum Anda sebutkan.",
    ]) {
      const out = reconcileReply(`Baik. ${said}`, state(utangPiutang, fullUtang, userUtang, { applied: [] }));
      expect(out, said).not.toContain(said);
      expect(out, said).toContain(READY_LINE);
    }
    // Tawaran koreksi bersyarat tetap.
    const offer = "Jika masih ada yang ingin dikoreksi, sebutkan saja.";
    expect(reconcileReply(offer, state(utangPiutang, fullUtang, userUtang, { applied: [] }))).toContain(offer);
  });

  // Fix round 1 (M3): kalimat sah yang mirip ungkapan sisa tetap ada.
  it("kalimat sah yang mirip ungkapan sisa dipertahankan (siap dan belum siap)", () => {
    const keep = [
      "Dokumen ini masih perlu ditandatangani kedua pihak.",
      "Maaf, saya masih belum bisa memberikan nasihat hukum.",
      "Kolom yang kosong boleh dilewati.",
      "Sisanya dicicil setiap bulan.",
      "Alamatnya masih kurang jelas.",
    ];
    const notReady = { creditor: "Rina Wulandari" };
    for (const s of keep) {
      expect(reconcileReply(s, state(utangPiutang, fullUtang, userUtang, { applied: [] })), `siap: ${s}`).toContain(s);
      expect(reconcileReply(s, state(utangPiutang, notReady, "Saya Rina Wulandari", { applied: [] })), `belum: ${s}`).toContain(s);
    }
    for (const s of ["Tidak ada data yang dikirim ke pihak lain.", "Tidak ada yang bisa saya jamin tentang keabsahan dokumen."]) {
      expect(reconcileReply(s, state(utangPiutang, notReady, "Saya Rina Wulandari", { applied: [] })), s).toContain(s);
    }
    // "kurang jelas" yang menyebut kolom yang sudah terisi tetap dibuang.
    expect(reconcileReply("Nama pemberi pinjaman masih kurang jelas.", state(utangPiutang, fullUtang, userUtang, { applied: [] }))).not.toContain("masih kurang jelas");
  });

  it("'tidak ada yang kurang' saat belum siap = klaim kesiapan palsu → dibuang", () => {
    const out = reconcileReply("Tidak ada lagi kolom yang kosong.", state(nda, { disclosingParty: "Sinta Dewi" }, "Saya Sinta Dewi", { applied: [] }));
    expect(out).not.toContain("Tidak ada lagi kolom yang kosong.");
    expect(out).toContain("Nama pihak yang menerima informasi rahasia?");
  });
});

// Task 22 (A02): istilah glosarium untuk rute penilaian khusus.
describe("normalizeSpecialCaseTerm", () => {
  it("'Kasus Khusus'/'kasus khusus' → 'Kasus Hukum Khusus (Special Legal Case)' sekali, berikutnya tanpa kurung", () => {
    expect(normalizeSpecialCaseTerm("Ini kasus khusus. Ajukan Kasus Khusus.")).toBe("Ini Kasus Hukum Khusus (Special Legal Case). Ajukan Kasus Hukum Khusus.");
    expect(normalizeSpecialCaseTerm("KASUS KHUSUS ya")).toBe("Kasus Hukum Khusus (Special Legal Case) ya");
  });

  it("tidak menggandakan '(Special Legal Case)' dan tidak menyentuh istilah yang sudah benar atau kata lain", () => {
    expect(normalizeSpecialCaseTerm("Lewat Kasus Khusus (Special Legal Case).")).toBe("Lewat Kasus Hukum Khusus (Special Legal Case).");
    expect(normalizeSpecialCaseTerm("Special Legal Case (kasus khusus) dinilai firma.")).toBe("Special Legal Case (Kasus Hukum Khusus) dinilai firma.");
    const ok = "Ajukan Kasus Hukum Khusus (Special Legal Case). Dokumen berkasus khusus, penilaian khusus, dan KASUS_KHUSUS tetap.";
    expect(normalizeSpecialCaseTerm(ok)).toBe(ok);
  });
});
