import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { CaseRequestForm } from "@/components/cases/case-request-form";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";
import { isUuid } from "@/lib/cases/pages";
import { casesService } from "@/lib/cases/runtime";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { submitCaseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ajukan Special Legal Case | Yuktanya" };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ document?: string }> }) {
  const q = await searchParams;
  const userId = await requireUserId();
  let doc: { id: string; title: string } | null = null;
  if (q.document) {
    // Dokumen orang lain atau id asing: 404 yang sama.
    const d = isUuid(q.document) ? await documentsService().get(userId, q.document) : null;
    if (!d) notFound();
    doc = { id: q.document, title: d.title };
    const open = await casesService().openForDocument(userId, doc.id);
    if (open) {
      return (
        <main className="max-w-3xl space-y-6">
          <PageHeading title="Special Legal Case sudah diajukan" lead={`Dokumen “${doc.title}” sudah memiliki pengajuan Special Legal Case yang masih berjalan.`} />
          <ButtonLink href={`/cases/${open}`}>Lihat status pengajuan</ButtonLink>
        </main>
      );
    }
  }
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Ajukan Special Legal Case" lead="Kasus Hukum Khusus (Special Legal Case) ditujukan untuk kebutuhan hukum yang rumit atau berisiko tinggi, yang tidak sesuai untuk Legal Review." />
      <Card className="space-y-3 border-amber-300 bg-amber-50/60">
        <p className="text-lg font-semibold text-navy">{SPECIAL_CASE_NOTE}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Firma hukum mitra lebih dulu memeriksa konflik kepentingan, lalu menilai kebutuhan Anda.</li>
          <li>Bila dapat menangani kebutuhan Anda, firma mengirim penawaran berisi biaya, ruang lingkup, dan batas waktu penawaran.</li>
          <li>Anda bebas menerima atau menolak penawaran. Menerima penawaran belum membuat tagihan; pembayaran dan perjanjian kerja diatur terpisah dengan firma.</li>
          <li>Selama pengajuan ini berjalan, dokumen terkait tidak dapat diajukan untuk Legal Review.</li>
        </ul>
      </Card>
      <Card className="space-y-4">
        {doc && <p>Dokumen terkait: <strong>{doc.title}</strong></p>}
        <CaseRequestForm action={submitCaseAction} documentId={doc?.id ?? null} idempotencyKey={randomUUID()} />
      </Card>
    </main>
  );
}
