import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeading } from "@/components/ui/card";
import { TemplateChooser } from "@/components/documents/template-chooser";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";
import { DOC_OPTIONS } from "@/lib/documents/options";
import { requireUserId } from "@/lib/documents/session";
import { createDocumentAction } from "../../documents/actions";
import { chooseTemplateAction } from "./actions";

// Task 24 (A04): fungsi tidak boleh dipotong sebelum tenggat giliran AI 75 detik (+ baca berkas/DB); harus literal untuk Next.
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const metadata = { title: "Bantu memilih dokumen | Yuktanya" };

// "Saya belum tahu" (D-01): wajib masuk (proxy + requireUserId); AI hanya menyarankan dokumen dari katalog.
export default async function ChooseTemplatePage() {
  await requireUserId();
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Bantu memilih dokumen" lead="Ceritakan keperluan Anda. AI akan menyarankan salah satu dokumen yang tersedia di Yuktanya. Setiap pesan yang dijawab AI memakai 1 kuota pesan AI." />
      <p className="text-muted">AI bukan pengacara dan tidak memberikan nasihat hukum. Anda juga dapat <Link className="inline-flex min-h-12 items-center underline" href="/workspace/new">memilih dokumen sendiri</Link>.</p>
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
