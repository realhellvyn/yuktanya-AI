import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/documents/chat-panel";
import { SLOW_AFTER_MS, SLOW_TEXT, SlowProgressText, startSlowTimer } from "@/components/documents/slow-progress";
import { CHAT_NOTICES } from "@/lib/vault/messages";

// Task 24 (A04): teks progres tenang setelah ~10 detik menunggu balasan AI. Lingkungan uji tanpa DOM: pewaktu diuji dengan
// timer palsu, tampilan diuji lewat markup; perilaku di browser nyata diuji di tests/e2e/journey-ux.mjs (LLM palsu ditunda).
describe("progres AI lambat", () => {
  afterEach(() => vi.useRealTimers());

  it("pewaktu memicu tepat setelah ambang 10 detik, tidak sebelumnya, dan dapat dibatalkan", () => {
    vi.useFakeTimers();
    expect(SLOW_AFTER_MS).toBe(10_000);
    const onSlow = vi.fn();
    startSlowTimer(SLOW_AFTER_MS, onSlow);
    vi.advanceTimersByTime(9_999);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const cancel = startSlowTimer(SLOW_AFTER_MS, cancelled);
    vi.advanceTimersByTime(5_000);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("wilayah aria-live polite selalu ada; teks hanya muncul saat lambat; tanpa animasi/spinner", () => {
    const off = renderToStaticMarkup(createElement(SlowProgressText, { show: false }));
    const on = renderToStaticMarkup(createElement(SlowProgressText, { show: true }));
    for (const h of [off, on]) {
      expect(h).toContain('role="status"');
      expect(h).toContain('aria-live="polite"');
      expect(h).not.toMatch(/animate-|spin|pulse/);
    }
    expect(off).not.toContain(SLOW_TEXT);
    expect(on).toContain("AI masih menyusun jawaban. Ini bisa memakan waktu hingga satu menit.");
  });

  it("ChatPanel memasang wilayah progres (kosong saat belum mengirim) di formulir kirim dan coba lagi", () => {
    const noop = async () => {};
    const h = renderToStaticMarkup(createElement(ChatPanel, { documentId: "d1", lines: [], greeting: "Halo!", action: noop, sendKey: "k1", retryKey: "k2", hasUnanswered: true, placeholder: "Contoh", userId: "u1" }));
    expect(h.match(/data-testid="ai-lambat"/g)).toHaveLength(2);
    expect(h).not.toContain(SLOW_TEXT);
  });

  it("pesan tenggat habis (percakapan dokumen) jelas: belum diproses, tersimpan, kuota tidak terpakai", () => {
    expect(CHAT_NOTICES.slow).toBe("AI sedang lambat, jadi pesan Anda belum diproses. Pesan Anda sudah tersimpan dan kuota AI Anda tidak terpakai. Tekan Coba lagi.");
  });
});
