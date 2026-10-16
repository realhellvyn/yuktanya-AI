import { describe, expect, it } from "vitest";
import { diffRendered } from "@/lib/documents/diff";
import { renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";
import type { Data } from "@/lib/documents/types";

const base: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};
const render = (d: Data) => renderDocument(nda, d, "DRAFT");

describe("diffRendered", () => {
  it("dokumen identik → semua same", () => {
    const d = diffRendered(render(base), render(base));
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((c) => c.change === "same")).toBe(true);
  });

  it("satu nilai field berubah → blok yang memakainya changed dengan before/after benar", () => {
    const d = diffRendered(render(base), render({ ...base, termMonths: 36 }));
    const changed = d.filter((c) => c.change === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: "term" });
    expect(changed[0].before).toContain("24 bulan");
    expect(changed[0].after).toContain("36 bulan");
  });

  it("klausul bersyarat muncul → added; hilang → removed (setelah blok dokumen baru)", () => {
    const withNotes = render({ ...base, additionalNotes: "Catatan" });
    const added = diffRendered(render(base), withNotes).filter((c) => c.change === "added");
    expect(added.map((c) => c.id)).toEqual(["notes:h", "notes"]);
    const all = diffRendered(withNotes, render(base));
    const removed = all.filter((c) => c.change === "removed");
    expect(removed.map((c) => c.id)).toEqual(["notes:h", "notes"]);
    expect(all.slice(-2).every((c) => c.change === "removed")).toBe(true);
  });

  it("deterministik dan tidak mengubah masukan", () => {
    const a = render(base);
    const b = render({ ...base, purpose: "Lain" });
    const snapshot = JSON.stringify([a, b]);
    expect(diffRendered(a, b)).toEqual(diffRendered(a, b));
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});
