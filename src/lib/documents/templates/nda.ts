// SINTETIS: teks klausul adalah placeholder netral, menunggu persetujuan mitra hukum. Bukan nasihat hukum.
import { defineTemplate, normalizeName } from "./base";

export const nda = defineTemplate({
  id: "nda",
  category: "NDA",
  version: 1,
  title: "Perjanjian Kerahasiaan (NDA)",
  fields: [
    { key: "disclosingParty", label: "Nama pihak yang membagikan informasi rahasia", example: "Contoh: Sinta Dewi", help: "Dituliskan sebagai pihak pertama di dokumen.", kind: "text", required: true },
    { key: "receivingParty", label: "Nama pihak yang menerima informasi rahasia", example: "Contoh: Budi Santoso", help: "Dituliskan sebagai pihak kedua di dokumen.", kind: "text", required: true },
    { key: "signingDate", label: "Tanggal perjanjian dibuat", example: "Contoh: 16 Oktober 2026", help: "Tanggal ini menjadi awal jangka waktu kerahasiaan.", kind: "date", required: true },
    { key: "confidentialInfo", label: "Informasi apa yang dirahasiakan", example: "Contoh: daftar pelanggan dan harga modal", help: "Semakin jelas, semakin mudah dipahami kedua pihak.", kind: "longtext", required: true },
    { key: "purpose", label: "Untuk apa informasi itu boleh dipakai", example: "Contoh: menilai rencana kerja sama", help: "Pihak penerima hanya boleh memakainya untuk tujuan ini.", kind: "longtext", required: true },
    { key: "termMonths", label: "Berapa bulan kerahasiaan berlaku", example: "Contoh: 24", help: "Dihitung sejak tanggal perjanjian.", kind: "integer", required: true },
    { key: "disputeCity", label: "Kota pengadilan bila terjadi sengketa", example: "Contoh: Jakarta Selatan", help: "Dipakai bila musyawarah tidak berhasil.", kind: "text", required: true },
    { key: "additionalNotes", label: "Catatan tambahan", example: "Boleh dikosongkan", help: "Hanya tampil di dokumen bila diisi.", kind: "longtext", required: false },
  ],
  clauses: [
    { id: "parties", heading: "Para Pihak", text: "Perjanjian ini dibuat pada {{signingDate}} antara {{disclosingParty}} (\"Pihak Pengungkap\") dan {{receivingParty}} (\"Pihak Penerima\")." },
    { id: "info", heading: "Informasi Rahasia", text: "Informasi rahasia dalam perjanjian ini adalah: {{confidentialInfo}}." },
    { id: "purpose", heading: "Tujuan Penggunaan", text: "Pihak Penerima hanya boleh menggunakan informasi rahasia untuk tujuan berikut: {{purpose}}." },
    { id: "term", heading: "Jangka Waktu", text: "Kewajiban menjaga kerahasiaan berlaku selama {{termMonths}} bulan terhitung sejak {{signingDate}}." },
    { id: "return", heading: "Pengembalian dan Pemusnahan", text: "Atas permintaan tertulis Pihak Pengungkap, Pihak Penerima mengembalikan atau memusnahkan informasi rahasia." },
    { id: "dispute", heading: "Penyelesaian Sengketa", text: "Sengketa diselesaikan secara musyawarah. Bila tidak tercapai, sengketa diselesaikan melalui Pengadilan Negeri {{disputeCity}}." },
    { id: "notes", heading: "Catatan Tambahan", text: "{{additionalNotes}}", whenKey: "additionalNotes" },
  ],
  cross: (d) =>
    normalizeName(d.disclosingParty) && normalizeName(d.disclosingParty) === normalizeName(d.receivingParty)
      ? { receivingParty: "Nama kedua pihak tidak boleh sama" }
      : {},
});
