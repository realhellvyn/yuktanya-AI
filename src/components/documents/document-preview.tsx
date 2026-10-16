import type { RenderedDoc } from "@/lib/documents/render";

export function DocumentPreview({ doc }: { doc: RenderedDoc }) {
  return (
    <article aria-label="Pratinjau dokumen" className="max-w-[720px] space-y-3 rounded-lg border border-line bg-white p-5">
      <p className="rounded border border-line bg-slate-50 p-2.5 text-base">{doc.label}</p>
      {doc.blocks.map((b) =>
        b.kind === "title" ? (
          <h2 key={b.id} className="text-2xl font-semibold">{b.text}</h2>
        ) : b.kind === "heading" ? (
          <h3 key={b.id} className="pt-2 text-lg font-semibold">{b.text}</h3>
        ) : (
          <p key={b.id} className="whitespace-pre-wrap">{b.text}</p>
        ),
      )}
    </article>
  );
}
