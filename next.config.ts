import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Unggahan dokumen (PDF/DOCX/TXT ≤ 4 MB) lewat server action. Fungsi Vercel menolak badan > ±4,5 MB sebelum aplikasi; batas
  // unggah 4 MB (src/lib/uploads/limits.ts) ditambah overhead multipart muat di bawahnya, dan batas Next 5 MB di atas keduanya.
  // Ukuran sebenarnya tetap divalidasi di server (src/lib/uploads/validate.ts). Next tidak mendukung batas per aksi; aksi lain
  // dibatasi 1 MB oleh proxy (src/lib/security/body-limit.ts, Task 24).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Header statis untuk semua jalur. CSP dengan nonce dipasang per permintaan oleh src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders({ production: process.env.NODE_ENV === "production" }) }];
  },
};

export default nextConfig;
