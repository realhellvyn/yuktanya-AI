// Asal URL kanonik aplikasi (tautan email, tautan berbagi, QR verifikasi). Di produksi gagal tertutup: tanpa
// NEXT_PUBLIC_APP_URL https yang valid, permintaan yang butuh URL ini gagal, alih-alih memakai localhost atau URL palsu.
export class AppUrlError extends Error {
  constructor() {
    super("NEXT_PUBLIC_APP_URL wajib diisi dengan URL https yang valid di produksi");
  }
}

export function appOrigin(env: { NODE_ENV?: string; NEXT_PUBLIC_APP_URL?: string } = process.env): string {
  const raw = (env.NEXT_PUBLIC_APP_URL ?? "").trim();
  let url: URL | null = null;
  try {
    url = raw ? new URL(raw) : null;
  } catch {
    url = null;
  }
  if (env.NODE_ENV === "production") {
    if (!url || url.protocol !== "https:" || url.username || url.password) throw new AppUrlError();
    return url.origin;
  }
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url.origin : "http://localhost:3000";
}
