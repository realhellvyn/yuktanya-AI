import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalNoteCard } from "@/components/reviews/legal-note-card";
import { ResultPanel } from "@/components/reviews/result-panel";
import { ReviewTimeline } from "@/components/reviews/review-timeline";
import { guardPath } from "@/lib/auth/permissions";
import { LEGAL_DISCLAIMER, NEW_VERSION_NOT_REVIEWED } from "@/lib/copy";
import type { NoteView, OwnerReview } from "@/lib/reviews/service";

const note: NoteView = { noteNo: 1, blockId: "term", quote: "24 bulan", title: "Jangka waktu", finding: "Tidak jelas", severity: "MATERIAL", actionable: true, recommendedAction: "Perjelas", rationale: "Risiko", escalation: "Konsultasi", status: "PUBLISHED" };
const review = (over: Partial<OwnerReview> = {}): OwnerReview => ({
  requestId: "r", versionId: "v", status: "COMPLETED", outcome: "WITH_NOTES", createdAt: "2026-10-16T05:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z",
  title: "NDA", versionNo: 2, scope: "Klausul kerahasiaan", assumptions: "Data benar", summary: null, notes: [note],
  verification: { id: "x", code: "c".repeat(48), status: "ACTIVE" },
  documentId: "d1", firmName: "Firma Sintetis & Rekan",
  timeline: { orderedAt: "2026-10-15T03:00:00.000Z", paidAt: "2026-10-15T04:00:00.000Z", queuedAt: "2026-10-15T04:00:00.000Z", assignedAt: "2026-10-16T02:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z" },
  credit: null, ...over,
});
const links = (h: string) => h.match(/<(a|button) [^>]*>/g) ?? [];

describe("ReviewTimeline", () => {
  it("status ditulis sebagai teks, bukan warna saja", () => {
    const h = renderToStaticMarkup(ReviewTimeline({ status: "IN_REVIEW" }));
    for (const s of ["Diajukan", "Pembayaran dikonfirmasi", "Dalam antrean", "Sedang diperiksa", "Selesai", "tahap ini", "belum"]) expect(h).toContain(s);
  });
});

describe("ReviewTimeline dengan tanggal (D-14)", () => {
  it("setiap tahap yang sudah dicapai memuat tanggal WIB; CANCELLED dijelaskan", () => {
    const t = review().timeline;
    const h = renderToStaticMarkup(ReviewTimeline({ status: "COMPLETED", timeline: t }));
    expect(h).toContain("15 Oktober 2026");
    expect(h).toContain("17 Oktober 2026");
    const c = renderToStaticMarkup(ReviewTimeline({ status: "CANCELLED", timeline: { ...t, assignedAt: null, completedAt: null } }));
    expect(c).toContain("Dibatalkan");
    expect(c).not.toContain("Diajukan — tahap ini");
  });
});

describe("LegalNoteCard", () => {
  it("tingkat sebagai teks Penting/Sangat penting, tindakan dan lokasi", () => {
    expect(renderToStaticMarkup(LegalNoteCard({ note }))).toContain("Penting");
    const h = renderToStaticMarkup(LegalNoteCard({ note: { ...note, severity: "CRITICAL" } }));
    expect(h).toContain("Sangat penting");
    expect(h).toContain("Perjelas");
    expect(h).toContain("term");
  });
});

describe("ResultPanel", () => {
  it("dengan catatan: judul hasil, ruang lingkup, versi, catatan, kode, URL, QR bukan tanda tangan, penafian", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review(), verifyUrl: "https://y.example/verify/abc", qrDataUrl: "data:image/png;base64,AAAA" }));
    for (const s of ["Selesai — Dengan Legal Note", "Klausul kerahasiaan", "versi 2", "Jangka waktu", "c".repeat(48), "https://y.example/verify/abc", "data:image/png;base64,AAAA", "bukan tanda tangan", LEGAL_DISCLAIMER, "Pemeriksaan selesai dengan catatan"]) expect(h).toContain(s);
    expect(h).not.toMatch(/\bcap\b/i);
    for (const tag of links(h)) expect(tag).toContain("min-h-12");
  });
  it("tanpa catatan memakai pernyataan WITHIN_SCOPE", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review({ outcome: "WITHIN_SCOPE", notes: [] }) }));
    expect(h).toContain("Selesai — Tanpa Legal Note");
    expect(h).toContain("memenuhi kriteria dalam ruang lingkup pemeriksaan");
  });
  it("INCONCLUSIVE tanpa badge dan tanpa kode", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review({ outcome: "INCONCLUSIVE", notes: [], verification: null, summary: "Bukti kurang" }) }));
    expect(h).toContain("tidak menghasilkan Yuktanya Legal Verified");
    expect(h).not.toContain("Kode:");
  });
  it("dicabut dan versi lama ditampilkan eksplisit", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review({ verification: { id: "x", code: "c".repeat(48), status: "REVOKED" } }), isLatestVersion: false }));
    expect(h).toContain("Status: Dicabut");
    expect(h).toContain(NEW_VERSION_NOT_REVIEWED);
  });
  it("D-07: pemeriksa (firma, tanpa data pribadi), tanggal selesai, unduhan jujur, dan Legal Note dijelaskan", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review() }));
    expect(h).toContain("Firma Sintetis &amp; Rekan");
    expect(h).toContain("17 Oktober 2026");
    expect(h).toContain("Catatan dari pemeriksa");
    expect(h).toContain('href="/documents/d1?version=v"');
    expect(h).toContain("belum tersedia sebagai berkas");
  });
  it("DECLINED: menjelaskan kredit pemeriksaan sesuai database dan langkah berikutnya", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review({ status: "DECLINED", outcome: "DECLINED", notes: [], verification: null, credit: { status: "AVAILABLE", expiresAt: "2027-01-14T05:00:00.000Z" } }) }));
    expect(h).toContain("1 kredit pemeriksaan");
    expect(h).toContain("14 Januari 2027");
    expect(h).toContain("tidak membayar lagi");
    expect(h).not.toMatch(/dikembalikan ke rekening|refund/i);
    const used = renderToStaticMarkup(ResultPanel({ review: review({ status: "DECLINED", outcome: "DECLINED", notes: [], verification: null, credit: { status: "CONSUMED", expiresAt: "2027-01-14T05:00:00.000Z" } }) }));
    expect(used).toContain("sudah terpakai");
  });
  it("INCONCLUSIVE: menjelaskan tanpa menjanjikan pengembalian dana", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review({ outcome: "INCONCLUSIVE", notes: [], verification: null }) }));
    expect(h).toContain("tidak membuat kredit atau pengembalian dana otomatis");
    expect(h).toContain("/cases/new?document=d1");
  });
  it("CANCELLED: bukan pesan menunggu", () => {
    const h = renderToStaticMarkup(ResultPanel({ review: review({ status: "CANCELLED", outcome: null, verification: null }) }));
    expect(h).toContain("dibatalkan");
    expect(h).not.toContain("belum selesai");
  });
  it("belum selesai → pesan menunggu", () => {
    expect(renderToStaticMarkup(ResultPanel({ review: review({ status: "IN_REVIEW", outcome: null }) }))).toContain("belum selesai");
  });
});

describe("guardPath /reviews", () => {
  it("peran profesional diarahkan keluar dari /reviews", () => {
    expect(guardPath("/reviews", ["reviewer"])).toEqual({ allow: false, redirect: "/partner" });
    expect(guardPath("/reviews/x", ["user"])).toEqual({ allow: true });
  });
});
