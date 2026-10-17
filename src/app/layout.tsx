import type { Metadata } from "next";
import { connection } from "next/server";
// Font disajikan dari origin sendiri (CSP font-src 'self'); tidak ada permintaan ke Google Fonts saat build atau runtime.
// Plus Jakarta Sans (variabel, semua teks) dan Source Serif 4 700 subset latin (hanya wordmark). Keduanya OFL-1.1.
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource/source-serif-4/latin-700.css";
import "./globals.css";

// URL kanonik untuk gambar Open Graph. Tanpa NEXT_PUBLIC_APP_URL yang valid, Next.js memakai bawaannya.
const metadataBase = (() => {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined;
  } catch {
    return undefined;
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: "Yuktanya",
  description: "Legal Service Seharga Secangkir Kopi.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // CSP dengan nonce per permintaan (src/proxy.ts) hanya bekerja pada render dinamis: halaman statis tidak membawa nonce
  // sehingga skripnya akan diblokir. Karena itu semua halaman dirender per permintaan.
  await connection();
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
