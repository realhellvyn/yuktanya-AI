// Mencetak kategori, id, versi, dan content hash ketiga template untuk commit yang sedang di-checkout.
// Dipakai saat mencatat ulang persetujuan template (lihat docs/RELEASE_CHECKLIST.md). Tidak menyentuh database.
// Memuat sumber TypeScript lewat jiti (sudah terpasang sebagai dependensi dev dari @tailwindcss/postcss).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let createJiti;
try {
  ({ createJiti } = await import("jiti"));
} catch {
  console.error("print-hashes: paket 'jiti' tidak ditemukan; jalankan 'npm ci' dulu.");
  process.exit(1);
}
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { TEMPLATES } = await jiti.import(join(root, "src/lib/documents/templates/registry.ts"));
for (const category of ["NDA", "PKS", "UTANG_PIUTANG"]) {
  const t = TEMPLATES[category];
  console.log(`${category}\t${t.id}\t${t.version}\t${t.contentHash()}`);
}
