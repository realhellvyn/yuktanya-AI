export type Category = "PKS" | "UTANG_PIUTANG" | "NDA";
// Dokumen unggahan pengguna (bukan dari template): versi tunggal yang dibekukan, tidak dapat diubah atau disalin.
export type DocCategory = Category | "UPLOAD";
export type FieldKind = "text" | "longtext" | "idr" | "date" | "integer" | "choice";
export type Data = Record<string, string | number>;

export type FieldSpec = {
  key: string;
  label: string;
  example?: string;
  help: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  // Awalan yang sudah ditulis klausul tepat di depan nilai ini (mis. "Pengadilan Negeri {{disputeCity}}"). Bila pengguna
  // ikut menulisnya ("PN Semarang"), awalan dibuang agar tercetak sekali; yang disimpan hanya nama kotanya.
  prefixes?: string[];
  // Nama yang kebetulan diawali salah satu awalan dan harus utuh (mis. "Kota Agung" adalah nama PN, bukan "Kota" + "Agung").
  keepWhole?: string[];
  // Nilai yang (setelah awalan dibuang) diawali kata ini ditolak validasi, mis. "Pengadilan Agama …" bukan Pengadilan Negeri.
  rejectStarts?: string[];
};

// Klausul dirender hanya bila field `whenKey` (jika ada) terisi. Teks memuat {{key}}.
export type ClauseSpec = { id: string; heading?: string; text: string; whenKey?: string };

// Tenggat yang dapat diingatkan (opt-in). Tidak memengaruhi keluaran dokumen, jadi tidak ikut hash persetujuan.
export type ReminderSpec = { id: string; label: string; date: (d: Data) => string | null };

export type ValidationResult = { ok: true; data: Data } | { ok: false; errors: Record<string, string> };

export type Template = {
  id: string;
  category: Category;
  version: number;
  title: string;
  fields: FieldSpec[];
  clauses: ClauseSpec[];
  reminders: ReminderSpec[];
  validate(d: Data): ValidationResult;
  // Bentuk baku nilai sebelum disimpan/dirender (mis. awalan kolom dibuang). Tidak menambah isi baru.
  normalize(d: Data): Data;
  contentHash(): string;
};
