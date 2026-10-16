import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
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
