import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeading } from "@/components/ui/card";
import { TemplateChooser } from "@/components/documents/template-chooser";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";
import { DOC_OPTIONS } from "@/lib/documents/options";
import { requireUserId } from "@/lib/documents/session";
import { createDocumentAction } from "../../documents/actions";
import { chooseTemplateAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bantu Memilih Dokumen | Yuktanya" };

// "Saya belum tahu" (D-01): wajib masuk (proxy + requireUserId); AI hanya menyarankan dokumen dari katalog.
export default async function ChooseTemplatePage() {
  await requireUserId();
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Belum tahu dokumen yang cocok?" lead="Ceritakan keperluan Anda. AI menyarankan salah satu dokumen yang tersedia di Yuktanya. Setiap pesan yang dijawab AI memakai 1 jatah pesan AI." />
      <p className="text-muted">AI bukan pengacara dan tidak memberi nasihat hukum. Anda juga bisa <Link className="inline-flex min-h-12 items-center underline" href="/workspace/new">memilih dokumen sendiri</Link>.</p>
      <TemplateChooser
        options={DOC_OPTIONS.map(({ category, title, text }) => ({ category, title, text }))}
        initialKey={randomUUID()}
        chooseAction={chooseTemplateAction}
        createAction={createDocumentAction}
        specialCaseNote={SPECIAL_CASE_NOTE}
      />
    </main>
  );
}
