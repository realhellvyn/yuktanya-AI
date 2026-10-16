export type Category = "PKS" | "UTANG_PIUTANG" | "NDA";
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
  contentHash(): string;
};
