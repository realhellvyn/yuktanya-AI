// Log operasional unggahan/analisis: hanya tahap, kode, dan NAMA galat. Pesan galat dapat memuat potongan isi
// berkas, jadi tidak pernah dicatat; isi dokumen juga tidak.
export function logUploadIssue(stage: "upload" | "ai_review", code: string, err?: unknown): void {
  const entry: Record<string, string> = { event: "upload_issue", stage, code };
  if (err instanceof Error) entry.error = err.name;
  console.warn(JSON.stringify(entry));
}
