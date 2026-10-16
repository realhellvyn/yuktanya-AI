import type { NoteView } from "@/lib/reviews/service";

const SEVERITY: Record<NoteView["severity"], string> = { INFO: "Informasi", MINOR: "Perlu diperhatikan", MATERIAL: "Penting", CRITICAL: "Sangat penting" };

export function LegalNoteCard({ note }: { note: NoteView }) {
  return (
    <article className="space-y-2 rounded-lg border border-slate-300 bg-white p-4">
      <h3 className="text-lg font-semibold">{note.title}</h3>
      <p><span className="font-medium">Tingkat:</span> {SEVERITY[note.severity]}</p>
      {note.quote && <blockquote className="border-l-4 border-slate-300 pl-3">{note.quote}</blockquote>}
      <p>{note.finding}</p>
      {note.recommendedAction && <p><span className="font-medium">Tindakan yang disarankan:</span> {note.recommendedAction}</p>}
      {note.rationale && <p><span className="font-medium">Alasan:</span> {note.rationale}</p>}
      {note.escalation && <p><span className="font-medium">Langkah lanjutan:</span> {note.escalation}</p>}
      {note.blockId && <p className="text-slate-700">Lokasi: bagian “{note.blockId}”</p>}
    </article>
  );
}
