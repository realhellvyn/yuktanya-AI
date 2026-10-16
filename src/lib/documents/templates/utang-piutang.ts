// SINTETIS: teks klausul adalah placeholder netral, menunggu persetujuan mitra hukum. Bukan nasihat hukum.
// Bunga dan jaminan sengaja tidak ada: kasus tersebut perlu penilaian khusus (lihat PRODUCT_SPEC.md).
import { defineTemplate, normalizeName } from "./base";

export const utangPiutang = defineTemplate({
  id: "utang-piutang",
  category: "UTANG_PIUTANG",
  version: 1,
  title: "Surat Utang Piutang",
  fields: [
    { key: "creditor", label: "Nama pemberi pinjaman", example: "Contoh: Rina Wulandari", help: "Orang atau badan yang meminjamkan uang.", kind: "text", required: true },
    { key: "debtor", label: "Nama peminjam", example: "Contoh: Agus Prasetyo", help: "Orang atau badan yang menerima pinjaman.", kind: "text", required: true },
    { key: "signingDate", label: "Tanggal surat dibuat", example: "Contoh: 16 Oktober 2026", help: "Tanggal pinjaman disepakati.", kind: "date", required: true },
    { key: "principalIdr", label: "Jumlah pinjaman (rupiah)", example: "Contoh: Rp5.000.000", help: "Tulis angka saja, tanpa desimal.", kind: "idr", required: true },
    { key: "dueDate", label: "Tanggal pinjaman harus lunas", example: "Contoh: 16 Januari 2027", help: "Harus setelah tanggal surat dibuat.", kind: "date", required: true },
    { key: "disputeCity", label: "Kota pengadilan bila terjadi sengketa", example: "Contoh: Surabaya", help: "Dipakai bila musyawarah tidak berhasil.", kind: "text", required: true },
    { key: "repaymentNote", label: "Catatan cara pembayaran", example: "Boleh dikosongkan", help: "Hanya tampil di dokumen bila diisi.", kind: "longtext", required: false },
  ],
  clauses: [
    { id: "parties", heading: "Para Pihak", text: "Surat ini dibuat pada {{signingDate}} antara {{creditor}} (\"Pemberi Pinjaman\") dan {{debtor}} (\"Peminjam\")." },
    { id: "principal", heading: "Jumlah Pinjaman", text: "Peminjam mengakui telah menerima pinjaman dari Pemberi Pinjaman sebesar {{principalIdr}}." },
    { id: "due", heading: "Jatuh Tempo", text: "Peminjam wajib melunasi pinjaman paling lambat pada {{dueDate}}." },
    { id: "note", heading: "Catatan Pembayaran", text: "{{repaymentNote}}", whenKey: "repaymentNote" },
    { id: "dispute", heading: "Penyelesaian Sengketa", text: "Sengketa diselesaikan secara musyawarah. Bila tidak tercapai, sengketa diselesaikan melalui Pengadilan Negeri {{disputeCity}}." },
  ],
  reminders: [{ id: "due", label: "Pinjaman jatuh tempo", date: (d) => (typeof d.dueDate === "string" ? d.dueDate : null) }],
  cross: (d): Record<string, string> => ({
    ...(normalizeName(d.creditor) && normalizeName(d.creditor) === normalizeName(d.debtor) ? { debtor: "Nama kedua pihak tidak boleh sama" } : {}),
    ...(typeof d.signingDate === "string" && typeof d.dueDate === "string" && d.dueDate <= d.signingDate ? { dueDate: "Tanggal lunas harus setelah tanggal surat dibuat" } : {}),
  }),
});
