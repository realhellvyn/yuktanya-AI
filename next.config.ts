import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Unggahan dokumen (PDF/DOCX/TXT ≤ 5 MB) lewat server action; batas sedikit di atas 5 MB untuk overhead multipart.
  // Ukuran sebenarnya tetap divalidasi di server (src/lib/uploads/validate.ts).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
