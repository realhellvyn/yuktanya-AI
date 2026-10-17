import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { StepIndicator } from "@/components/ui/step-indicator";

export const metadata = { title: "Pratinjau desain | Yuktanya", robots: { index: false, follow: false } };

const field = "mt-2 block min-h-12 w-full rounded-xl border bg-surface px-4 text-lg";
const TONES = ["info", "success", "warning", "danger", "neutral"] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-2xl font-bold text-navy">{title}</h2>
      {children}
    </section>
  );
}

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-8 md:px-8">
        <PageHeading title="Pratinjau desain" lead="Halaman internal untuk memeriksa komponen. Halaman ini tidak memuat data pengguna." />

        <Section id="tombol" title="Tombol">
          <div className="flex flex-wrap gap-3">
            <Button>Utama</Button>
            <Button variant="secondary">Sekunder</Button>
            <Button variant="quiet">Tautan</Button>
            <Button disabled>Nonaktif</Button>
            <ButtonLink href="/design-preview">Tombol tautan</ButtonLink>
          </div>
        </Section>

        <Section id="kartu" title="Kartu dan keadaan kosong">
          <Card><p>Kartu biasa dengan isi singkat.</p></Card>
          <Card className="border-amber-300 bg-amber-50"><p>Kartu peringatan.</p></Card>
          <EmptyState title="Belum ada dokumen" text="Buat dokumen pertama Anda untuk memulai." action={<Button>Buat dokumen</Button>} />
        </Section>

        <Section id="status" title="Lencana status">
          <div className="flex flex-wrap gap-3">
            {TONES.map((t) => <StatusBadge key={t} tone={t}>{`Status ${t}`}</StatusBadge>)}
          </div>
        </Section>

        <Section id="langkah" title="Indikator langkah">
          <StepIndicator current={1} total={4} percent={0} />
          <StepIndicator current={2} total={4} percent={50} />
          <StepIndicator current={4} total={4} percent={100} />
        </Section>

        <Section id="isian" title="Isian formulir">
          <form className="space-y-5" aria-label="Contoh isian">
            <label className="block"><span className="font-semibold">Biasa</span>
              <input className={`${field} border-border-strong`} placeholder="Ketik di sini" />
            </label>
            <label className="block"><span className="font-semibold">Terisi</span>
              <input className={`${field} border-border-strong`} defaultValue="Sinta Dewi" />
            </label>
            <label className="block"><span className="font-semibold">Nonaktif</span>
              <input className={`${field} border-line bg-subtle`} disabled defaultValue="Tidak dapat diubah" />
            </label>
            <label className="block"><span className="font-semibold">Salah isi</span>
              <input className={`${field} border-danger`} defaultValue="abc" aria-invalid="true" aria-describedby="err-demo" />
              <span id="err-demo" role="alert" className="mt-1 block font-semibold text-danger">Format tanggal belum sesuai. Tulis seperti contoh: 16 Oktober 2026.</span>
            </label>
            <label className="block"><span className="font-semibold">Pilihan</span>
              <select className={`${field} border-border-strong`}><option>Perjanjian Kerahasiaan</option><option>Surat Utang Piutang</option></select>
            </label>
            <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-6 w-6" /><span>Saya mengerti</span></label>
          </form>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
