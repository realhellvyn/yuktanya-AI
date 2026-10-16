export type Attribution = { utm_source?: string; utm_campaign?: string; utm_creative?: string };

const KEYS = ["utm_source", "utm_campaign", "utm_creative"] as const;

export function parseAttribution(params: URLSearchParams): Attribution {
  const out: Attribution = {};
  for (const key of KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value.slice(0, 100);
  }
  return out;
}
