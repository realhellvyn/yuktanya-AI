export type PlanKey = "FREE" | "MEMBER";

// Harga terkunci v8 (integer IDR). Sumber tunggal di TypeScript; seed DB diuji terhadap ini.
export const PRICING = {
  membershipMonthlyIdr: 19000,
  standard: { free: 50000, memberFirst: 30000, memberLater: 35000 },
  deepAdditional: { free: 200000, member: 150000 },
} as const;

export const QUOTAS: Record<PlanKey, { messages: number; documents: number; aiReviews: number }> = {
  FREE: { messages: 20, documents: 1, aiReviews: 2 },
  MEMBER: { messages: 60, documents: 5, aiReviews: 10 },
};

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatIdr(n: number): string {
  return `Rp${idr.format(n)}`;
}
