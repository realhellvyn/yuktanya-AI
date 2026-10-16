import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AI_DRAFT_LABEL, LEGAL_DISCLAIMER, SLOGAN } from "@/lib/copy";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";

export const metadata = { title: "Yuktanya — Legal Service Seharga Secangkir Kopi" };

const DOCS = [
  { title: "Perjanjian Kerja Sama", text: "Untuk kerja sama usaha atau proyek." },
  { title: "Surat Utang Piutang", text: "Untuk pinjam-meminjam uang." },
  { title: "Perjanjian Kerahasiaan (NDA)", text: "Untuk menjaga informasi rahasia." },
];
const STEPS = [
  { n: "1", title: "Pilih dokumen", text: "Pilih jenis dokumen yang Anda butuhkan." },
  { n: "2", title: "Jawab pertanyaan", text: "Jawab satu per satu dengan bahasa sehari-hari. Jawaban tersimpan otomatis." },
  { n: "3", title: "Unduh dokumen", text: "Dapatkan dokumen Word atau PDF. Pemeriksaan pengacara bersifat pilihan." },
];
const FAQ = [
  { q: "Apakah AI sama dengan pengacara?", a: "Bukan. AI membantu menyusun draf. Draf belum diperiksa oleh profesional hukum sampai Anda meminta pemeriksaan." },
  { q: "Apakah saya wajib membayar?", a: "Tidak. Membuat dokumen dengan bantuan AI gratis dalam batas pemakaian harian. Pemeriksaan pengacara bersifat pilihan dan berbayar." },
  { q: "Apakah pembayaran menjamin hasil yang baik?", a: "Tidak. Pembayaran adalah biaya pemeriksaan. Biaya tidak menjamin hasil positif atau keabsahan dokumen." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="bg-gradient-to-b from-blue-50 to-canvas">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:px-8 md:py-20 lg:grid-cols-2 lg:items-center">
            <div className="space-y-6">
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-navy md:text-5xl">Buat dokumen hukum lebih mudah</h1>
              <p className="text-xl text-muted">{SLOGAN} Jawab beberapa pertanyaan sederhana, lalu dapatkan draf dokumen. Pemeriksaan oleh pengacara bersifat pilihan dan berbayar.</p>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/register">Daftar Gratis</ButtonLink>
                <ButtonLink href="#cara-kerja" variant="secondary">Lihat Cara Kerja</ButtonLink>
              </div>
              <p className="text-sm text-muted">{AI_DRAFT_LABEL}</p>
            </div>
            <Card aria-hidden="true" className="hidden space-y-3 lg:block">
              <p className="text-sm font-semibold text-muted">Contoh tampilan (bukan dokumen sungguhan)</p>
              <div className="h-3 w-2/3 rounded-full bg-slate-200" />
              <div className="h-3 w-full rounded-full bg-slate-100" />
              <div className="h-3 w-5/6 rounded-full bg-slate-100" />
              <div className="h-3 w-1/2 rounded-full bg-slate-200" />
              <div className="h-3 w-full rounded-full bg-slate-100" />
            </Card>
          </div>
        </section>

        <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 md:px-8">
          <section aria-labelledby="docs" className="space-y-5">
            <h2 id="docs" className="text-3xl font-bold text-navy">Dokumen yang bisa dibuat</h2>
            <ul className="grid gap-4 md:grid-cols-3">
              {DOCS.map((d) => (
                <li key={d.title}><Card className="h-full"><h3 className="text-lg font-bold text-navy">{d.title}</h3><p className="mt-1 text-muted">{d.text}</p></Card></li>
              ))}
            </ul>
          </section>

          <section id="cara-kerja" aria-labelledby="cara" className="scroll-mt-24 space-y-5">
            <h2 id="cara" className="text-3xl font-bold text-navy">Cara kerja</h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <Card className="h-full space-y-2">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-navy font-bold text-white" aria-hidden="true">{s.n}</span>
                    <h3 className="text-lg font-bold text-navy"><span className="sr-only">Langkah {s.n}: </span>{s.title}</h3>
                    <p className="text-muted">{s.text}</p>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="harga" className="space-y-5">
            <h2 id="harga" className="text-3xl font-bold text-navy">Harga yang jelas</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="space-y-3">
                <h3 className="text-xl font-bold text-navy">Akun Gratis</h3>
                <p>Buat dokumen dengan AI: <strong>Gratis</strong></p>
                <p>Pemeriksaan pengacara: <strong>{formatIdr(PRICING.standard.free)}</strong> per dokumen standar</p>
              </Card>
              <Card className="space-y-3">
                <h3 className="text-xl font-bold text-navy">Member ({formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan)</h3>
                <p>Pemeriksaan pertama setiap periode: <strong>{formatIdr(PRICING.standard.memberFirst)}</strong></p>
                <p>Pemeriksaan berikutnya: <strong>{formatIdr(PRICING.standard.memberLater)}</strong></p>
              </Card>
            </div>
            <ButtonLink href="/pricing" variant="quiet">Lihat rincian harga</ButtonLink>
          </section>

          <section aria-labelledby="batas" className="space-y-3">
            <h2 id="batas" className="text-3xl font-bold text-navy">Yang perlu Anda ketahui</h2>
            <Card className="space-y-2 border-amber-300 bg-amber-50">
              <p>{AI_DRAFT_LABEL} AI bukan pengacara.</p>
              <p>{LEGAL_DISCLAIMER}</p>
            </Card>
          </section>

          <section aria-labelledby="faq" className="space-y-4">
            <h2 id="faq" className="text-3xl font-bold text-navy">Pertanyaan umum</h2>
            <div className="space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="rounded-2xl border border-line bg-white p-4">
                  <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-navy">{f.q}</summary>
                  <p className="mt-2 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
