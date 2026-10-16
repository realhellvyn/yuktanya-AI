import type { z } from "zod";

export type InterviewResult<T> = { ok: true; data: T } | { ok: false; fallback: "manual_form" };

const stripFences = (raw: string) => raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

function tryParse<T>(schema: z.ZodType<T>, raw: string): { ok: true; data: T } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(stripFences(raw));
  } catch (err) {
    return { ok: false, error: `JSON tidak valid: ${(err as Error).message}` };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

// Model "auto" dapat berganti antar panggilan, jadi keluaran JSON selalu divalidasi dan hanya diperbaiki secara terbatas.
// maxRepairs = 2 adalah default rekayasa, bukan keputusan pemilik.
export async function parseInterviewJson<T>(
  schema: z.ZodType<T>,
  raw: string,
  repair: (raw: string, error: string) => Promise<string>,
  maxRepairs = 2,
): Promise<InterviewResult<T>> {
  let current = raw;
  for (let attempt = 0; ; attempt++) {
    const r = tryParse(schema, current);
    if (r.ok) return { ok: true, data: r.data };
    if (attempt >= maxRepairs) return { ok: false, fallback: "manual_form" };
    try {
      current = await repair(current, r.error);
    } catch {
      return { ok: false, fallback: "manual_form" };
    }
  }
}
