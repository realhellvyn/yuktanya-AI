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

// Cookie atribusi sentuhan pertama (30 hari). secure di produksi.
export function attributionCookieOptions(production: boolean = process.env.NODE_ENV === "production") {
  return { httpOnly: true, sameSite: "lax" as const, secure: production, maxAge: 60 * 60 * 24 * 30, path: "/" };
}
