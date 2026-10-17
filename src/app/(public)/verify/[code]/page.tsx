import { headers } from "next/headers";
import { SiteHeader } from "@/components/site-header";
import { PublicVerification } from "@/components/verification/public-verification";
import { clientIp } from "@/lib/auth/rate-limit";
import { rateLimiter } from "@/lib/security/limiters";
import { verificationService } from "@/lib/verification/runtime";

// Halaman publik tanpa login dan tanpa cache: status dicabut harus terlihat seketika. Tidak ada daftar atau pencarian kode.
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // 30 permintaan/menit per IP, lintas instance (DB); gagal DB = tetap dilayani (fail-open, dicatat).
  if (!(await rateLimiter("verify_page").allow(clientIp(await headers())))) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl p-6"><p role="status">Terlalu banyak permintaan. Tunggu sebentar, lalu muat ulang halaman ini.</p></main>
      </>
    );
  }
  const result = await verificationService().lookup(code);
  return (
    <>
      <SiteHeader />
      <PublicVerification result={result} code={code} />
    </>
  );
}
