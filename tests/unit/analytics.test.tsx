import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrendChart } from "@/components/admin/trend-chart";
import { buildAlerts, compareText, parseAnalyticsQuery } from "@/lib/admin/analytics";
import { CONSENT_RECORDS, DOC_EVENT_NAMES, EVENT_CATALOGUE, RECORDED_EVENT_NAMES, SAFE_METADATA_KEYS, sanitizeMetadata } from "@/lib/analytics/catalogue";
import { trackEvent } from "@/lib/analytics/events";

describe("katalog event", () => {
  it("memuat ke-28 nama event dari ADMIN_DASHBOARD.md (19 minimal + 9 tambahan v8 yang unik)", () => {
    const minimal = ["signup_completed", "ai_request_started", "ai_request_succeeded", "ai_request_failed", "document_started", "draft_completed",
      "review_requested", "review_payment_verified", "review_assigned", "review_completed", "special_case_submitted", "quote_sent", "quote_accepted",
      "membership_activated", "payment_refunded", "ai_verification_issued", "legal_verification_issued", "legal_enhanced_verification_issued", "verification_revoked"];
    const v8 = ["standard_completed", "legal_note_published", "deep_eligible", "deep_offer_shown", "deep_quote_accepted", "deep_payment_verified",
      "deep_assigned", "deep_completed", "deep_approval_recorded", "legal_enhanced_verification_issued", "verification_revoked"];
    const expected = [...new Set([...minimal, ...v8])].sort();
    expect(expected).toHaveLength(28);
    expect([...DOC_EVENT_NAMES].sort()).toEqual(expected);
  });
  it("setiap event dokumen punya nama tercatat dan sumber; tiga event kasus khusus memakai nama dari Task 5", () => {
    for (const e of EVENT_CATALOGUE) {
      expect(e.recordedAs).toMatch(/^[a-z_]+$/);
      expect(["db", "server"]).toContain(e.source);
    }
    const alias = Object.fromEntries(EVENT_CATALOGUE.map((e) => [e.name, e.recordedAs]));
    expect(alias.special_case_submitted).toBe("special_case_requested");
    expect(alias.quote_sent).toBe("special_case_quote_sent");
    expect(alias.quote_accepted).toBe("special_case_quote_accepted");
    expect(RECORDED_EVENT_NAMES).toContain("document_uploaded");
    expect(RECORDED_EVENT_NAMES).toContain("ai_review_completed");
    for (const c of CONSENT_RECORDS) expect(RECORDED_EVENT_NAMES).not.toContain(c);
  });
  it("metadata: hanya kunci daftar-izin dengan nilai skalar pendek tanpa spasi; teks hukum/nama/isi dibuang", () => {
    const out = sanitizeMetadata({
      category: "NDA", amount_idr: 50000, actionable: true, title: "Jangka waktu", finding: "Tidak jelas", name: "Sinta Dewi",
      email: "a@b.test", prompt: "RAHASIA", outcome: "Sinta Dewi", nested: { a: 1 } as never, latency_ms: 120, error_code: "x".repeat(65),
    });
    expect(out).toEqual({ category: "NDA", amount_idr: 50000, actionable: true, latency_ms: 120 });
    for (const k of Object.keys(out)) expect(SAFE_METADATA_KEYS).toContain(k);
    expect(SAFE_METADATA_KEYS).not.toContain("title");
    expect(SAFE_METADATA_KEYS).not.toContain("summary");
  });
  it("trackEvent best-effort: galat basis data tidak pernah dilempar; nama di luar katalog tidak ditulis", async () => {
    const calls: unknown[] = [];
    const broken = { query: async () => { throw new Error("db mati"); } };
    await expect(trackEvent(broken as never, { name: "deep_offer_shown", dedupeKey: "x" })).resolves.toBe(false);
    const ok = { query: async (...a: unknown[]) => { calls.push(a); return { rows: [{ ok: true }] }; } };
    await expect(trackEvent(ok as never, { name: "bukan_event" as never, dedupeKey: "y" })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    await expect(trackEvent(ok as never, { name: "deep_offer_shown", dedupeKey: "z", metadata: { category: "NDA", title: "Rahasia" } })).resolves.toBe(true);
    expect(JSON.stringify(calls)).not.toContain("Rahasia");
  });
});

describe("parseAnalyticsQuery", () => {
  const now = new Date("2026-10-16T18:30:00Z"); // 17 Oktober 01.30 WIB
  it("default 7 hari WIB tanpa filter; pembanding = rentang sama panjang tepat sebelumnya", () => {
    const q = parseAnalyticsQuery({}, now);
    expect(q.error).toBeUndefined();
    expect(q.from.toISOString()).toBe("2026-10-10T17:00:00.000Z");
    expect(q.to.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(q.prevFrom.toISOString()).toBe("2026-10-03T17:00:00.000Z");
    expect(q.prevTo.toISOString()).toBe(q.from.toISOString());
    expect(q.category).toBeNull();
    expect(q.membership).toBeNull();
  });
  it("rentang khusus memakai batas tengah malam WIB, akhir inklusif dalam hari", () => {
    const q = parseAnalyticsQuery({ dari: "2026-10-01", sampai: "2026-10-03", jenis: "NDA", anggota: "MEMBER" }, now);
    expect(q.error).toBeUndefined();
    expect(q.from.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(q.to.toISOString()).toBe("2026-10-03T17:00:00.000Z");
    expect(q.prevFrom.toISOString()).toBe("2026-09-27T17:00:00.000Z");
    expect(q.category).toBe("NDA");
    expect(q.membership).toBe("MEMBER");
    expect(q.label).toContain("1 Okt 2026");
  });
  it("masukan salah: pesan jelas, nilai ketikan disimpan, data kembali ke 7 hari", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ dari: "2026-10-05", sampai: "2026-10-01" }, /akhir.*sebelum|setelah tanggal awal/i],
      [{ dari: "2026-02-30", sampai: "2026-03-01" }, /tidak valid/i],
      [{ dari: "abc", sampai: "2026-03-01" }, /tidak valid/i],
      [{ dari: "2024-01-01", sampai: "2026-10-01" }, /366 hari/],
      [{ dari: "2026-10-01", sampai: "2026-10-30" }, /setelah hari ini/],
      [{ dari: "2026-10-01" }, /keduanya/],
    ];
    for (const [input, msg] of cases) {
      const q = parseAnalyticsQuery(input, now);
      expect(q.error, JSON.stringify(input)).toMatch(msg);
      expect(q.typed.dari).toBe(input.dari ?? "");
      expect(q.to.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    }
  });
  it("filter tak dikenal diabaikan (bukan disuntikkan)", () => {
    const q = parseAnalyticsQuery({ jenis: "x'; drop", anggota: "ADMIN" }, now);
    expect(q.category).toBeNull();
    expect(q.membership).toBeNull();
  });
});

describe("perbandingan dan peringatan", () => {
  it("compareText menyebut naik/turun/sama dan tanpa persen bila sebelumnya nol", () => {
    expect(compareText(12, 10)).toBe("Naik 20% dari periode sebelumnya (10)");
    expect(compareText(5, 10)).toBe("Turun 50% dari periode sebelumnya (10)");
    expect(compareText(3, 3)).toBe("Sama dengan periode sebelumnya (3)");
    expect(compareText(4, 0)).toBe("Periode sebelumnya: 0");
    expect(compareText(null, 3)).toBe("Belum ada data");
  });
  it("peringatan muncul untuk antrean terlambat, galat AI di atas ambang, bayar tanpa antrean, rekonsiliasi", () => {
    const base = { overdue_hours: 72, overdue_reviews: 0, overdue_deep: 0, unassigned: 0, paid_not_queued: 0, reconciliation: 0,
      ai_24h: { requests: 10, failed: 1, rate: 0.1 }, ai_rate_threshold: 0.2, ai_min_requests: 5 };
    expect(buildAlerts(base)).toEqual([]);
    const a = buildAlerts({ ...base, overdue_reviews: 2, overdue_deep: 1, paid_not_queued: 1, reconciliation: 3, ai_24h: { requests: 10, failed: 4, rate: 0.4 } });
    expect(a.map((x) => x.code)).toEqual(["REVIEW_OVERDUE", "DEEP_OVERDUE", "AI_ERRORS", "PAID_NOT_QUEUED", "RECONCILIATION"]);
    expect(a[0].text).toContain("72 jam");
    expect(a[2].text).toContain("40%");
    // terlalu sedikit permintaan → tidak ada alarm palsu
    expect(buildAlerts({ ...base, ai_24h: { requests: 2, failed: 2, rate: 1 } })).toEqual([]);
    expect(buildAlerts({ ...base, ai_24h: null })).toEqual([]);
  });
});

describe("TrendChart", () => {
  it("SVG sebaris dengan label aksesibel, tooltip per batang, tabel data, dan keadaan kosong jujur", () => {
    const html = renderToStaticMarkup(<TrendChart id="t1" title="Dokumen dimulai" days={["2026-10-15", "2026-10-16"]} values={[2, 5]} />);
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain("Dokumen dimulai");
    expect(html).toContain("<title>16 Okt: 5</title>");
    expect(html).toContain("<table");
    const none = renderToStaticMarkup(<TrendChart id="t2" title="Galat AI" days={["2026-10-16"]} values={null} />);
    expect(none).toContain("Belum ada data");
    expect(none).not.toContain("<svg");
  });
});

describe("deep_offer_shown hanya saat penawaran benar-benar tampil", () => {
  it("track dipanggil untuk pemilik layak; tidak untuk yang tidak layak; galat track tidak menggagalkan halaman", async () => {
    const { loadDeepOfferPage } = await import("@/lib/deep/owner-pages");
    const id = "11111111-1111-4111-8111-111111111111";
    const svc = (eligible: boolean) => ({
      eligibility: async () => ({ eligible, reason: eligible ? "OK" : "NO_ACTIONABLE_NOTES", quote: eligible ? { amountIdr: 200000 } : null }),
      forParent: async () => null,
    }) as never;
    const seen: string[] = [];
    const track = async (_u: string, r: string) => void seen.push(r);
    expect((await loadDeepOfferPage({ service: svc(true), flag: true, track }, "u", id)).kind).toBe("offer");
    expect((await loadDeepOfferPage({ service: svc(false), flag: true, track }, "u", id)).kind).toBe("ineligible");
    expect(seen).toEqual([id]);
    const broken = async () => { throw new Error("db mati"); };
    expect((await loadDeepOfferPage({ service: svc(true), flag: true, track: broken }, "u", id)).kind).toBe("offer");
  });
});
