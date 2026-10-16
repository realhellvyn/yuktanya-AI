import { afterAll, describe, expect, it } from "vitest";
import { createPgDeepService } from "@/lib/deep/service";
import { loadDeepOfferPage, loadDeepStatusPage } from "@/lib/deep/owner-pages";
import { createUser, getPool } from "./helpers";
import { makeKit } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const service = createPgDeepService(pool);
const on = { service, flag: true };

describe("halaman Deep Review pemilik", () => {
  it("flag mati: halaman tawaran 404 walau pemilik sah", async () => {
    const c = await kit.completedStandard();
    expect((await loadDeepOfferPage({ service, flag: false }, c.owner, c.req)).kind).toBe("notFound");
  });
  it("pemilik lain dan id acak mendapat 404 yang sama; pemilik melihat tawaran dengan harga", async () => {
    const c = await kit.completedStandard();
    const other = await createUser(pool);
    expect((await loadDeepOfferPage(on, other, c.req)).kind).toBe("notFound");
    expect((await loadDeepOfferPage(on, c.owner, "00000000-0000-4000-8000-000000000000")).kind).toBe("notFound");
    const ok = await loadDeepOfferPage(on, c.owner, c.req);
    expect(ok.kind).toBe("offer");
    if (ok.kind === "offer") expect(ok.eligibility.quote?.amountIdr).toBe(200000);
  });
  it("tawaran membawa harga pemeriksaan standar yang sudah dibayar dari order induk (Free Rp50.000, Member pertama Rp30.000)", async () => {
    const free = await kit.completedStandard();
    const a = await loadDeepOfferPage(on, free.owner, free.req);
    expect(a.kind === "offer" && a.eligibility.standardPaidIdr).toBe(50000);
    const member = await kit.completedStandard({ member: true });
    const b = await loadDeepOfferPage(on, member.owner, member.req);
    expect(b.kind === "offer" && b.eligibility.standardPaidIdr).toBe(30000);
    expect(b.kind === "offer" && b.eligibility.quote?.amountIdr).toBe(150000);
  });
  it("sudah dipesan: tawaran mengalihkan ke halaman status; status hanya untuk pemilik", async () => {
    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
    const r = await loadDeepOfferPage(on, c.owner, c.req);
    expect(r).toEqual({ kind: "redirect", to: `/deep-reviews/${deep}` });
    const other = await createUser(pool);
    expect((await loadDeepStatusPage(service, other, deep)).kind).toBe("notFound");
    expect((await loadDeepStatusPage(service, c.owner, "bukan-uuid")).kind).toBe("notFound");
    const s = await loadDeepStatusPage(service, c.owner, deep);
    expect(s.kind).toBe("ok");
    if (s.kind === "ok") {
      expect(s.deep.status).toBe("QUEUED");
      expect(s.assigned).toBe(false);
    }
    await service.assign(c.f.coordinator, deep, c.r.reviewer);
    const s2 = await loadDeepStatusPage(service, c.owner, deep);
    expect(s2.kind === "ok" && s2.assigned).toBe(true);
  });
  it("tidak layak: induk tanpa catatan yang perlu ditindaklanjuti menampilkan alasan, bukan tawaran", async () => {
    const c = await kit.completedStandard({ severity: "MINOR", actionable: false });
    const r = await loadDeepOfferPage(on, c.owner, c.req);
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.eligibility.reason).toBe("NO_ACTIONABLE_NOTES");
  });
  it("tidak layak: order Deep yang masih menunggu pembayaran → DEEP_EXISTS, tanpa tawaran kedua", async () => {
    const c = await kit.completedStandard();
    await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const r = await loadDeepOfferPage(on, c.owner, c.req);
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.eligibility.reason).toBe("DEEP_EXISTS");
  });
  it("id bukan UUID ditolak sebelum menyentuh DB (offer dan status)", async () => {
    const c = await kit.completedStandard();
    for (const bad of ["bukan-uuid", "", "1; drop table x", "../deep"]) {
      expect((await loadDeepOfferPage(on, c.owner, bad)).kind).toBe("notFound");
      expect((await loadDeepStatusPage(service, c.owner, bad)).kind).toBe("notFound");
    }
  });
  it("reviewer dan admin (bukan pemilik) mendapat notFound yang sama pada tawaran dan status", async () => {
    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
    for (const who of [c.r.reviewer, c.f.admin, c.f.coordinator]) {
      expect((await loadDeepOfferPage(on, who, c.req)).kind).toBe("notFound");
      expect((await loadDeepStatusPage(service, who, deep)).kind).toBe("notFound");
    }
  });
});
