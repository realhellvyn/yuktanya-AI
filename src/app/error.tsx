"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ErrorView } from "@/components/error-view";

// Galat tak terduga di halaman mana pun di bawah layout akar.
// Coba lagi: ambil ulang data server (router.refresh) lalu render ulang batas galat (reset); reset() saja tidak
// memulihkan galat yang terjadi saat render di server.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return <ErrorView digest={error.digest} onRetry={() => startTransition(() => { router.refresh(); reset(); })} />;
}
