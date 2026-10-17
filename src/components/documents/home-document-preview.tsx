import { renderDocument, type Block } from "@/lib/documents/render";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import type { Data } from "@/lib/documents/types";
import { cn } from "@/lib/utils";

// Data contoh tetap untuk pratinjau di beranda. Fiktif, tetapi lolos validasi template yang sama dengan aplikasi.
export const SAMPLE_LOAN: Data = {
  creditor: "Sinta Dewi",
  debtor: "Budi Santoso",
  signingDate: "2026-10-17",
  principalIdr: 5_000_000,
  dueDate: "2027-04-17",
  disputeCity: "Jakarta Selatan",
};

type Clause = { id: string; heading: string; text: string };

// Potongan Surat Utang Piutang dari renderer template aplikasi (tanpa AI, tanpa DB). Teks pasal tidak pernah ditulis ulang di
// sini. Hanya judul dan pasal yang diambil: catatan persetujuan template dan label AI tidak ikut, karena pratinjau ini bukan
// dokumen pengguna dan tidak membawa lencana, tanda tangan, QR, atau kode verifikasi.
export function sampleLoanPreview(): { title: string; clauses: Clause[] } {
  const doc = renderDocument(utangPiutang, SAMPLE_LOAN, "DRAFT");
  const title = doc.blocks.find((b) => b.kind === "title")?.text ?? utangPiutang.title;
  const clauses: Clause[] = [];
  let heading: Block | undefined;
  for (const b of doc.blocks) {
    if (b.kind === "heading") heading = b;
    else if (b.kind === "paragraph" && heading && b.id === heading.id.replace(/:h$/, "")) {
      clauses.push({ id: b.id, heading: heading.text, text: b.text });
      heading = undefined;
    }
  }
  return { title, clauses };
}

// Kertas dokumen: latar putih, judul di tengah, pasal bernomor. Bagian bawah memudar ke latar halaman sehingga terlihat
// terpotong dengan sengaja. Di HP lebih pendek, tetapi tetap tampil.
export function HomeDocumentPreview({ className }: { className?: string }) {
  const { title, clauses } = sampleLoanPreview();
  return (
    <figure aria-labelledby="pratinjau-dokumen-h" className={cn("relative mx-auto w-full max-w-md", className)}>
      <div className="relative h-80 overflow-hidden rounded-lg border border-line bg-surface px-6 pt-8 shadow-[0_10px_30px_rgba(13,27,42,0.10)] md:h-[26rem] md:px-10 md:pt-10">
        <h2 id="pratinjau-dokumen-h" className="text-center text-lg font-bold uppercase tracking-wide text-heading md:text-xl">{title}</h2>
        <div className="mx-auto mt-2 h-px w-16 bg-line" aria-hidden="true" />
        <ol className="mt-6 space-y-5 text-[0.95rem] leading-relaxed text-ink">
          {clauses.map((c, i) => (
            <li key={c.id} className="space-y-1">
              <h3 className="text-center font-bold text-heading">
                <span className="block text-sm font-semibold uppercase tracking-wide text-muted">Pasal {i + 1}</span>
                {c.heading}
              </h3>
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-canvas md:h-40" />
      </div>
    </figure>
  );
}
