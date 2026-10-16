import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AiReviewReport } from "@/lib/ai/prereview";
import { AI_PREREVIEW_LABEL, VERIFICATION_STATEMENTS, VERIFICATION_TITLES } from "@/lib/copy";

const GROUPS: { key: keyof AiReviewReport; title: string }[] = [
  { key: "perhatian", title: "Hal yang perlu diperhatikan" },
  { key: "belumJelas", title: "Informasi yang belum jelas" },
  { key: "pertanyaanUntukPengacara", title: "Saran pertanyaan untuk pengacara" },
];

// Hasil analisis awal AI dikelompokkan sesuai docs/WIREFRAMES.md §8. Isi dari model selalu dirender sebagai teks biasa
// (React meng-escape), tidak pernah sebagai HTML. AI Verified ditampilkan terpisah dan tegas bukan Legal Verified.
export function AiReviewResult({ report, completedAt, verified }: { report: AiReviewReport; completedAt: string; verified: boolean }) {
  const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(completedAt));
  return (
    <Card className="space-y-4" aria-labelledby="hasil-ai-h">
      <div className="space-y-2">
        <h3 id="hasil-ai-h" className="text-xl font-bold text-navy">Hasil analisis awal AI</h3>
        <p className="text-sm text-muted">Selesai {when} WIB</p>
        <div className="flex flex-wrap gap-2">
          {verified && <StatusBadge tone="info">{VERIFICATION_TITLES.AI}</StatusBadge>}
          <StatusBadge tone="warning">Bukan Legal Verified — belum diperiksa pengacara</StatusBadge>
        </div>
      </div>
      <p role="note" className="rounded-xl border border-amber-400 bg-amber-50 p-3 font-semibold text-amber-900">{AI_PREREVIEW_LABEL}</p>
      {verified && <p className="text-muted">{VERIFICATION_STATEMENTS.AI}</p>}
      {GROUPS.map((g) => (
        <section key={g.key} className="space-y-2">
          <h4 className="text-lg font-semibold text-navy">{g.title}</h4>
          {report[g.key].length === 0 ? (
            <p className="text-muted">Tidak ada.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-6">
              {report[g.key].map((t, i) => <li key={i} className="break-words">{t}</li>)}
            </ul>
          )}
        </section>
      ))}
    </Card>
  );
}
