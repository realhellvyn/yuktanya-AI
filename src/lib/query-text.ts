// Nilai dari alamat (?error=, ?notice=, ?e=, ...) dapat dibuat siapa saja lewat tautan. Jangan pernah menampilkannya apa
// adanya: petakan kode yang dikenal ke kalimat tetap. Object.hasOwn menolak nama bawaan objek ("__proto__", "toString").
export function fixedText<T extends Record<string, string>>(map: T, key: unknown): string | undefined {
  return typeof key === "string" && Object.hasOwn(map, key) ? map[key] : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// Email dari alamat hanya ditampilkan tersamar, dan hanya bila bentuknya email sederhana.
const EMAIL = /^([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/;
export function maskEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = EMAIL.exec(v.trim());
  if (!m) return null;
  return `${m[1].slice(0, 2)}***@${m[2]}`;
}
