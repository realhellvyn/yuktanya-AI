import { formatIdr } from "@/lib/pricing/catalog";

export const NO_DATA = "Belum ada data";
const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export type Range = { from: Date; to: Date; days: 1 | 7 | 30; label: string };

// Rentang dalam hari WIB penuh; akhir eksklusif. Default 7 hari terakhir; nilai ngawur → default.
export function parseRange(q: { r?: string }, now: Date = new Date()): Range {
  const days = (q.r === "1" ? 1 : q.r === "30" ? 30 : 7) as 1 | 7 | 30;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const start = new Date(`${today}T00:00:00+07:00`);
  const to = new Date(start.getTime() + 86_400_000);
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to, days, label: days === 1 ? "Hari ini" : `${days} hari terakhir` };
}

export const fmtCount = (v: number | null | undefined): string => (v === null || v === undefined ? NO_DATA : nf.format(v));
export const fmtIdr = (v: number | null | undefined): string => (v === null || v === undefined ? NO_DATA : formatIdr(v));
export const fmtPercent = (v: number | string | null | undefined): string => (v === null || v === undefined ? NO_DATA : `${nf.format(Number(v) * 100)}%`);
export const fmtMs = (v: number | string | null | undefined): string => (v === null || v === undefined ? NO_DATA : `${nf.format(Number(v))} ms`);
export const fmtHours = (v: number | string | null | undefined): string => (v === null || v === undefined ? NO_DATA : `${nf.format(Number(v))} jam`);
