"use client";

import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource/source-serif-4/latin-700.css";
import "./globals.css";
import { ErrorView } from "@/components/error-view";

// Galat di layout akar: menggantikan seluruh dokumen, jadi memuat <html>/<body> sendiri.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body>
        <title>Terjadi kendala | Yuktanya</title>
        <ErrorView digest={error.digest} onRetry={reset} />
      </body>
    </html>
  );
}
