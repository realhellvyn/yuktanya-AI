import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatPanel } from "@/components/documents/chat-panel";
import { PartialPreview } from "@/components/documents/partial-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StepIndicator } from "@/components/ui/step-indicator";
import { listMessages } from "@/lib/documents/conversation";
import { getPool } from "@/lib/db";
import { renderPartial } from "@/lib/documents/render";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import { missingRequired, progress, summarize } from "@/lib/documents/wizard";
import { CHAT_NOTICES } from "@/lib/vault/messages";
import { freezeAction, sendMessageAction } from "../../documents/actions";
import { fixedText } from "@/lib/query-text";

export const metadata = { title: "Isi dokumen | Yuktanya" };

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
// Task 24 (A04): fungsi tidak boleh dipotong sebelum tenggat giliran AI 75 detik (+ baca berkas/DB); harus literal untuk Next.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const GREETING: Record<string, string> = {
  UTANG_PIUTANG: "Selamat datang. Ceritakan pinjaman yang ingin dicatat: siapa yang meminjamkan, siapa yang meminjam, berapa jumlahnya, dan kapan harus dilunasi. Bagian yang belum jelas akan saya tanyakan satu per satu.",
  NDA: "Selamat datang. Ceritakan informasi yang ingin dijaga: siapa yang membagikan informasi rahasia, siapa penerimanya, dan informasi apa yang dirahasiakan. Bagian yang belum jelas akan saya tanyakan satu per satu.",
  PKS: "Selamat datang. Ceritakan kerja sama yang direncanakan: siapa saja pihaknya, bentuk kerja samanya, dan berapa lama berlangsung. Bagian yang belum jelas akan saya tanyakan satu per satu.",
};
const PLACEHOLDER: Record<string, string> = {
  UTANG_PIUTANG: "Contoh: Saya Sinta Dewi meminjamkan Rp5.000.000 kepada Budi Santoso, dikembalikan 16 April 2027.",
  NDA: "Contoh: Saya Sinta Dewi ingin menjaga rahasia daftar pelanggan dari Budi Santoso selama 12 bulan.",
  PKS: "Contoh: Saya Sinta Dewi dan Budi Santoso ingin bekerja sama membuka kedai kopi selama 24 bulan.",
};

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  const doc = await documentsService().get(userId, id);
  if (!doc) notFound();
  // Dokumen unggahan tidak punya wawancara/draf: langsung ke halaman dokumennya.
  if (doc.category === "UPLOAD") redirect(`/documents/${id}`);
  const t = TEMPLATES[doc.category];
  const data = doc.draft.data;
  const messages = await listMessages(getPool(), userId, id);
  const missing = missingRequired(t, data);
  const validity = t.validate(data);
  const conflicts = !validity.ok ? Object.values(validity.errors).filter((m) => m !== "Wajib diisi") : [];
  const ready = missing.length === 0 && validity.ok;
  const bar = progress(t, data);
  const preview = <PartialPreview title={t.title} rows={renderPartial(t, data)} />;
  const notice = fixedText(CHAT_NOTICES, q.notice);
  const hasUnanswered = messages.at(-1)?.role === "user" && !messages.at(-1)?.answered;

  return (
    <main className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
      <div className="max-w-2xl space-y-5">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-3xl">{t.title}</h1>
        <StepIndicator current={bar.done} total={bar.total} percent={bar.percent} label={`${bar.done} dari ${bar.total} isian wajib terisi`} />
        {notice && <p role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold">{notice} <Link className="inline-flex min-h-12 items-center underline" href="/bantuan">Bantuan</Link></p>}
        {missing.length === 0 && conflicts.length > 0 && (
          <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">Ada isian yang belum sesuai: {conflicts.join(" ")} Tulis perbaikannya di percakapan.</p>
        )}

        {ready && (
          <Card aria-label="Dokumen siap dibuat" className="space-y-4 border-green-300 bg-green-50">
            <h2 className="text-xl font-bold text-navy">Dokumen siap dibuat</h2>
            <details>
              <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-link underline underline-offset-4">Lihat ringkasan jawaban</summary>
              <dl className="mt-2 space-y-2">
                {summarize(t, data).map((s) => (
                  <div key={s.label}>
                    <dt className="text-sm font-semibold text-muted">{s.label}</dt>
                    <dd className="font-medium">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p>Untuk mengubah isian, tulis perubahannya di percakapan di bawah, misalnya “ganti nama pihak kedua menjadi …”.</p>
            <form action={freezeAction} className="space-y-3">
              <input type="hidden" name="documentId" value={id} />
              <input type="hidden" name="token" value={randomUUID()} />
              <Button type="submit" className="w-full text-lg">Buat dokumen</Button>
              <p className="text-sm text-muted">Dokumen yang sudah dibuat tidak dapat diubah. Perubahan berikutnya disimpan sebagai versi baru.</p>
            </form>
          </Card>
        )}

        <ChatPanel
          documentId={id}
          lines={messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
          greeting={GREETING[doc.category]}
          action={sendMessageAction}
          sendKey={randomUUID()}
          retryKey={randomUUID()}
          hasUnanswered={Boolean(hasUnanswered)}
          placeholder={PLACEHOLDER[doc.category]}
          userId={userId}
        />
        {doc.versions.length > 0 && <Link className="inline-flex min-h-12 items-center font-semibold text-link underline" href={`/documents/${id}`}>Lihat versi yang sudah dibuat</Link>}
        <details className="rounded-2xl border border-line bg-surface p-4 lg:hidden">
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-link underline underline-offset-4">Lihat draf dokumen</summary>
          <div className="mt-3">{preview}</div>
        </details>
      </div>
      <aside className="hidden lg:block" aria-label="Draf dokumen">
        <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto">{preview}</div>
      </aside>
    </main>
  );
}
