import { AI_DRAFT_LABEL } from "@/lib/copy";
import type { PartialRow } from "@/lib/documents/render";

// Pratinjau bertahap: klausul muncul begitu semua isiannya ada. Hanya tampilan; dokumen resmi dibuat setelah semua wajib terisi.
export function PartialPreview({ title, rows }: { title: string; rows: PartialRow[] }) {
  return (
    <article aria-label="Pratinjau draf" className="space-y-3 rounded-2xl border border-line bg-surface p-5 md:p-6">
      <p className="rounded-lg bg-subtle p-2.5 text-base text-muted">{AI_DRAFT_LABEL}</p>
      <h2 className="text-xl font-bold text-navy">{title}</h2>
      {rows.map((r) => (
        <section key={r.id} className="space-y-1">
          {r.heading && <h3 className="font-semibold text-navy">{r.heading}</h3>}
          <p className={r.complete ? "whitespace-pre-wrap" : "whitespace-pre-wrap rounded-lg border border-dashed border-line px-3 py-2 text-muted"}>{r.text}</p>
        </section>
      ))}
    </article>
  );
}
