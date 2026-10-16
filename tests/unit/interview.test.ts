import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseInterviewJson } from "@/lib/ai/interview";

const schema = z.object({ party: z.string().min(1), amountIdr: z.number().int().nonnegative() });
const good = JSON.stringify({ party: "PT Contoh", amountIdr: 5000000 });

describe("parseInterviewJson", () => {
  it("JSON valid → ok tanpa memanggil repair", async () => {
    const repair = vi.fn();
    expect(await parseInterviewJson(schema, good, repair)).toEqual({ ok: true, data: { party: "PT Contoh", amountIdr: 5000000 } });
    expect(repair).not.toHaveBeenCalled();
  });

  it("JSON rusak lalu valid pada percobaan ke-2 → ok, repair 1×", async () => {
    const repair = vi.fn(async () => good);
    const r = await parseInterviewJson(schema, "{party: ", repair);
    expect(r.ok).toBe(true);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("selalu rusak → fallback manual_form, repair tepat 2×", async () => {
    const repair = vi.fn(async () => "masih bukan json");
    expect(await parseInterviewJson(schema, "bukan json", repair)).toEqual({ ok: false, fallback: "manual_form" });
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("JSON valid tetapi skema salah (jumlah negatif) diperlakukan sebagai gagal dan diperbaiki", async () => {
    const repair = vi.fn(async () => good);
    const r = await parseInterviewJson(schema, JSON.stringify({ party: "A", amountIdr: -5 }), repair);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0][1]).toMatch(/amountIdr/);
    expect(r).toMatchObject({ ok: true, data: { amountIdr: 5000000 } });
  });

  it("pagar ```json dipangkas sebelum parse", async () => {
    const repair = vi.fn();
    const r = await parseInterviewJson(schema, "```json\n" + good + "\n```", repair);
    expect(r.ok).toBe(true);
    expect(repair).not.toHaveBeenCalled();
  });

  it("repair yang melempar → fallback manual_form, bukan crash", async () => {
    const repair = vi.fn(async () => { throw new Error("gateway mati"); });
    expect(await parseInterviewJson(schema, "rusak", repair)).toEqual({ ok: false, fallback: "manual_form" });
  });
});
