import { headers } from "next/headers";
import { PublicShare } from "@/components/vault/public-share";
import { SiteHeader } from "@/components/site-header";
import { ackEmailAvailable } from "@/lib/vault/email-config";
import { publicLimiter, shareService } from "@/lib/vault/runtime";
import { requestAckAction, verifyAckAction } from "./actions";

// Halaman publik tanpa login. Tidak pernah di-cache, dan hanya menampilkan isi satu versi yang dibagikan.
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ step?: string; e?: string; result?: string; error?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!publicLimiter.allow(ip)) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl p-6"><p role="status">Terlalu banyak permintaan. Coba lagi sebentar.</p></main>
      </>
    );
  }
  const view = await shareService().resolve(token);
  return (
    <>
      <SiteHeader />
      <PublicShare view={view} token={token} requestAction={requestAckAction} verifyAction={verifyAckAction} ackAvailable={ackEmailAvailable()} step={q.step} email={q.e} result={q.result} error={q.error} />
    </>
  );
}
