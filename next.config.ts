import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Unggahan dokumen (PDF/DOCX/TXT ≤ 5 MB) lewat server action; batas sedikit di atas 5 MB untuk overhead multipart.
  // Ukuran sebenarnya tetap divalidasi di server (src/lib/uploads/validate.ts).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // Header statis untuk semua jalur. CSP dengan nonce dipasang per permintaan oleh src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders({ production: process.env.NODE_ENV === "production" }) }];
  },
};

export default nextConfig;
