import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const refresh = vi.fn(() => { calls.push("refresh"); });
const captured: { onRetry?: () => void } = {};
// Perender server menolak startTransition; di sini dijalankan langsung dan dicatat agar terbukti dibungkus transisi.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useTransition: () => [false, (cb: () => void) => { calls.push("transition"); cb(); }] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/error-view", () => ({
  ErrorView: (props: { onRetry: () => void }) => { captured.onRetry = props.onRetry; return null; },
}));
import ErrorPage from "@/app/error";

// Galat saat render di server hanya pulih bila data server diambil ulang: Coba lagi = router.refresh() lalu reset(), dalam startTransition.
describe("app/error.tsx: Coba lagi", () => {
  beforeEach(() => { calls.length = 0; refresh.mockClear(); captured.onRetry = undefined; });
  it("dalam startTransition memanggil router.refresh() lalu reset()", () => {
    const reset = vi.fn(() => { calls.push("reset"); });
    renderToStaticMarkup(createElement(ErrorPage, { error: new Error("x"), reset }));
    expect(captured.onRetry).toBeTypeOf("function");
    captured.onRetry!();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["transition", "refresh", "reset"]);
  });
});
