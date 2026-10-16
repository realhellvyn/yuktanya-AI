import QRCode from "qrcode";
import { appOrigin } from "@/lib/app-url";

// URL kanonik pencarian publik. Tidak memuat data pribadi; hanya kode opaque.
// Basis bawaan: NEXT_PUBLIC_APP_URL (gagal tertutup di produksi bila kosong atau bukan https).
export function verifyUrl(code: string, base?: string): string {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(code)) throw new Error("Kode verifikasi tidak valid");
  return `${(base ?? appOrigin()).replace(/\/+$/, "")}/verify/${code}`;
}

export async function qrPng(url: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 6 });
  return new Uint8Array(buf);
}
