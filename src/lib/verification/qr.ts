import QRCode from "qrcode";

// URL kanonik pencarian publik. Tidak memuat data pribadi; hanya kode opaque.
export function verifyUrl(code: string, base: string = process.env.NEXT_PUBLIC_APP_URL ?? "https://yuktanya.example"): string {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(code)) throw new Error("Kode verifikasi tidak valid");
  return `${base.replace(/\/+$/, "")}/verify/${code}`;
}

export async function qrPng(url: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 6 });
  return new Uint8Array(buf);
}
