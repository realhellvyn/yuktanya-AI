import { timingSafeEqual } from "node:crypto";

// Autentikasi pekerjaan terjadwal (Vercel Cron: header "Authorization: Bearer $CRON_SECRET").
// Mengembalikan Response penolakan, atau null bila lolos. Rahasia < 16 karakter dianggap belum dikonfigurasi.
export function cronAuthError(secret: string | undefined, req: Request): Response | null {
  if (!secret || secret.length < 16) return Response.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  return null;
}
