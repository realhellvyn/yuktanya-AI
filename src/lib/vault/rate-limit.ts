// Pembatas laju jendela geser, per proses. Permintaan yang ditolak tidak dicatat sehingga tidak memperpanjang hukuman.
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;
  return {
    allow(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => x > t - opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.every((x) => x <= t - opts.windowMs)) hits.delete(k);
      }
      return true;
    },
  };
}
