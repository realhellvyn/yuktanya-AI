import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { ClearLocalDrafts } from "./clear-drafts";

export const metadata = { title: "Akun dihapus | Yuktanya", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ sebagian?: string }> }) {
  const { sebagian } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <ClearLocalDrafts />
        <PageHeading title="Akun Anda sudah dihapus" lead="Terima kasih telah menggunakan Yuktanya." />
        <Card className="space-y-3">
          <p>Dokumen, percakapan, berkas, tautan berbagi, dan pengingat Anda sudah dihapus. Anda juga sudah keluar dari akun.</p>
          <p>Catatan pesanan, pembayaran, dan audit tetap disimpan untuk pencocokan keuangan, tanpa terhubung lagi ke email Anda. Kode verifikasi yang sudah terbit tetap bisa dicek orang lain, tetapi isi dokumennya sudah dikosongkan.</p>
          {sebagian === "1" && (
            <p role="status" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold">
              Data Anda sudah dihapus, tetapi penutupan akses masuk belum selesai karena gangguan sistem. Tim kami akan menyelesaikannya. Anda tidak perlu melakukan apa pun.
            </p>
          )}
        </Card>
        <ButtonLink href="/">Kembali ke Beranda</ButtonLink>
      </main>
      <SiteFooter />
    </>
  );
}
