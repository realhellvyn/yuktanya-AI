import { describe, expect, it } from "vitest";
import { FIELD_CUES, reconcileReply, sanitizeReply, type ReplyState } from "@/lib/ai/reply-guard";
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
});
