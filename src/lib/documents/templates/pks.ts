// SINTETIS: teks klausul adalah placeholder netral, menunggu persetujuan mitra hukum. Bukan nasihat hukum.
import { defineTemplate, normalizeName } from "./base";

export const pks = defineTemplate({
  id: "pks",
  category: "PKS",
  version: 1,
  title: "Perjanjian Kerja Sama",
  fields: [
    { key: "partyA", label: "Nama pihak pertama", example: "Contoh: PT Maju Bersama", help: "Pihak yang memulai kerja sama.", kind: "text", required: true },
    { key: "partyB", label: "Nama pihak kedua", example: "Contoh: CV Karya Mandiri", help: "Pihak yang diajak bekerja sama.", kind: "text", required: true },
    { key: "signingDate", label: "Tanggal perjanjian dibuat", example: "Contoh: 16 Oktober 2026", help: "Tanggal kedua pihak sepakat.", kind: "date", required: true },
    { key: "scope", label: "Pekerjaan atau kerja sama apa yang disepakati", example: "Contoh: pembuatan situs web toko online", help: "Tuliskan hasil yang diharapkan.", kind: "longtext", required: true },
    { key: "startDate", label: "Tanggal kerja sama mulai", example: "Contoh: 1 November 2026", help: "Awal kerja sama berjalan.", kind: "date", required: true },
    { key: "endDate", label: "Tanggal kerja sama berakhir", example: "Contoh: 1 Februari 2027", help: "Harus setelah tanggal mulai.", kind: "date", required: true },
    { key: "valueIdr", label: "Nilai kerja sama (rupiah)", example: "Contoh: Rp15.000.000", help: "Tulis angka saja, tanpa desimal.", kind: "idr", required: true },
    { key: "paymentDueDays", label: "Pembayaran dilakukan berapa hari setelah tagihan", example: "Contoh: 14", help: "Jumlah hari kalender.", kind: "integer", required: true },
    { key: "disputeCity", label: "Kota pengadilan bila terjadi sengketa", example: "Contoh: Bandung", help: "Dipakai bila musyawarah tidak berhasil.", kind: "text", required: true },
  ],
  clauses: [
    { id: "parties", heading: "Para Pihak", text: "Perjanjian ini dibuat pada {{signingDate}} antara {{partyA}} (\"Pihak Pertama\") dan {{partyB}} (\"Pihak Kedua\")." },
    { id: "scope", heading: "Ruang Lingkup", text: "Para pihak sepakat bekerja sama dalam hal berikut: {{scope}}." },
    { id: "term", heading: "Jangka Waktu", text: "Kerja sama berlaku sejak {{startDate}} sampai dengan {{endDate}}." },
    { id: "payment", heading: "Nilai dan Pembayaran", text: "Nilai kerja sama adalah {{valueIdr}}. Pembayaran dilakukan paling lambat {{paymentDueDays}} hari setelah tagihan diterima." },
    { id: "termination", heading: "Pengakhiran", text: "Salah satu pihak dapat mengakhiri perjanjian dengan pemberitahuan tertulis kepada pihak lainnya." },
    { id: "dispute", heading: "Penyelesaian Sengketa", text: "Sengketa diselesaikan secara musyawarah. Bila tidak tercapai, sengketa diselesaikan melalui Pengadilan Negeri {{disputeCity}}." },
  ],
  reminders: [{ id: "end", label: "Kerja sama berakhir", date: (d) => (typeof d.endDate === "string" ? d.endDate : null) }],
  cross: (d): Record<string, string> => ({
    ...(normalizeName(d.partyA) && normalizeName(d.partyA) === normalizeName(d.partyB) ? { partyB: "Nama kedua pihak tidak boleh sama" } : {}),
    ...(typeof d.startDate === "string" && typeof d.endDate === "string" && d.endDate <= d.startDate ? { endDate: "Tanggal berakhir harus setelah tanggal mulai" } : {}),
  }),
});
