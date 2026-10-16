import { headers } from "next/headers";
import { SiteHeader } from "@/components/site-header";
import { PublicVerification } from "@/components/verification/public-verification";
import { createRateLimiter } from "@/lib/vault/rate-limit";
import { verificationService } from "@/lib/verification/runtime";

// Halaman publik tanpa login dan tanpa cache: status dicabut harus terlihat seketika. Tidak ada daftar atau pencarian kode.
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!limiter.allow(ip)) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl p-6"><p role="status">Terlalu banyak permintaan. Coba lagi sebentar.</p></main>
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
