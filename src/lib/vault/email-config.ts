// Ketersediaan pengiriman email untuk konfirmasi baca dan pengingat, dibaca dari env (EMAIL_PROVIDER).
// Adapter penyedia email nyata BELUM ADA (penyedia belum dipilih), jadi di produksi selalu tidak tersedia. "mock" hanya untuk
// pengembangan/tes lokal (email tidak benar-benar terkirim). Saat adapter nyata ditambahkan: kode konfirmasi (berlaku 10 menit)
// harus dikirim langsung setelah diminta, bukan menunggu job outbox harian.
export type EmailEnv = { NODE_ENV?: string; EMAIL_PROVIDER?: string };

export function emailProvider(env: EmailEnv = process.env): "mock" | null {
  const p = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (p === "mock" && env.NODE_ENV !== "production") return "mock";
  return null;
}

export const ackEmailAvailable = (env: EmailEnv = process.env): boolean => emailProvider(env) !== null;
