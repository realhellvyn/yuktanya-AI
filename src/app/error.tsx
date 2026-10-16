"use client";

import { ErrorView } from "@/components/error-view";

// Galat tak terduga di halaman mana pun di bawah layout akar.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView digest={error.digest} onRetry={reset} />;
}
