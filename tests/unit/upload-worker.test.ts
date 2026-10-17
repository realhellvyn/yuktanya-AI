import { mkdirSync } from "node:fs";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { Document, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UPLOAD_LIMITS } from "@/lib/uploads/limits";
import { extractUploadText } from "@/lib/uploads/parse";
import { extractUploadTextIsolated, MAX_PARSE_WORKERS, PARSE_QUEUE_WAIT_MS, PARSE_WORKER_LIMITS, type SpawnParseWorker, type WorkerInput } from "@/lib/uploads/parse-isolated";
import { UPLOAD_MESSAGES } from "@/lib/uploads/messages";

// Task 24 (A05): pembacaan berkas di worker_threads dengan batas waktu keras. Berkas worker asli (src/lib/uploads/parse-worker.ts)
// dibundel dengan rolldown (dependensi vitest) agar dapat dijalankan Node di uji; build produksi Next membundelnya sendiri
// (dibuktikan dengan `npm run test:e2e:prod`, lihat laporan Task 24).
const LIMITS = UPLOAD_LIMITS.FREE;
const SECRET = "RAHASIA-ISI-BERKAS-7731";
const enc = (s: string) => new TextEncoder().encode(s);
const OUT = path.join(process.cwd(), "node_modules/.cache/yk-parse-worker");
const BUNDLE = path.join(OUT, "parse-worker.mjs");

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const { build } = await import("rolldown");
  await build({
    input: path.join(process.cwd(), "src/lib/uploads/parse-worker.ts"),
    platform: "node",
    // Paket node_modules tetap eksternal; berkas keluaran di dalam repo sehingga resolusi Node menemukan node_modules.
    external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
    output: { file: BUNDLE, format: "esm" },
    logLevel: "silent",
  });
}, 60_000);

const real: SpawnParseWorker = (input, options) => new Worker(BUNDLE, { ...options, workerData: input });
// Worker sintetis dari kode sumber (eval) untuk mensimulasikan worker macet / galat / pesan rusak.
const fake = (code: string, seen?: { options?: WorkerOptions; worker?: Worker }): SpawnParseWorker => (input: WorkerInput, options) => {
  const w = new Worker(code, { ...options, eval: true, workerData: input });
  if (seen) Object.assign(seen, { options, worker: w });
  return w;
};

async function docxOf(paragraphs: string[]): Promise<Uint8Array> {
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: paragraphs.map((t) => new Paragraph({ text: t })) }] })));
}
async function pdfOf(pages: string[][]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = d.addPage();
    lines.forEach((l, i) => p.drawText(l, { x: 50, y: 700 - i * 20, font: f, size: 12 }));
  }
  return d.save();
}

describe("pembacaan berkas terisolasi (worker_threads)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("PDF/DOCX/TXT normal lewat worker = hasil fungsi murni di proses (termasuk kode penolakan)", async () => {
    const pdf = await pdfOf([["Perjanjian Sewa (sintetis)", "Pasal 1 Para pihak sepakat."], ["Pasal 2 Penutup"]]);
    const many = await pdfOf(Array.from({ length: 11 }, (_, i) => [`Halaman ${i + 1} berisi teks yang cukup panjang`]));
    const cases: [WorkerInput["kind"], Uint8Array][] = [
      ["TXT", enc("Perjanjian Sewa\n\nPasal 1\nPara pihak sepakat.")],
      ["DOCX", await docxOf(["Perjanjian Kerja Sama", "Pasal 1 Hak & Kewajiban <para pihak>"])],
      ["PDF", pdf],
      ["PDF", many],
      ["PDF", enc("%PDF-1.4 rusak")],
      ["TXT", enc(" \n\n \t")],
    ];
    for (const [kind, bytes] of cases) {
      const inProcess = await extractUploadText(kind, bytes, LIMITS);
      expect(await extractUploadTextIsolated(kind, bytes, LIMITS, { spawn: real })).toEqual(inProcess);
    }
    expect((await extractUploadTextIsolated("PDF", pdf, LIMITS, { spawn: real })).ok).toBe(true);
    expect(await extractUploadTextIsolated("PDF", many, LIMITS, { spawn: real })).toEqual({ ok: false, code: "TOO_MANY_PAGES" });
  }, 60_000);

  it("worker macet di kerja sinkron dihentikan (terminate) setelah batas waktu → TIMEOUT", async () => {
    const seen: { options?: WorkerOptions; worker?: Worker } = {};
    const exited = vi.fn();
    const spawn: SpawnParseWorker = (input, options) => {
      const w = fake("for (;;) {}", seen)(input, options);
      w.once("exit", exited);
      return w;
    };
    const t0 = Date.now();
    const r = await extractUploadTextIsolated("PDF", enc("%PDF-1.4"), { ...LIMITS, timeoutMs: 300 }, { spawn });
    expect(r).toEqual({ ok: false, code: "TIMEOUT" });
    // Batas longgar (bukan uji waktu ketat): worker yang tidak dihentikan akan berputar selamanya.
    expect(Date.now() - t0).toBeLessThan(10_000);
    await vi.waitFor(() => expect(exited).toHaveBeenCalled(), { timeout: 5000 });
    expect(seen.options?.resourceLimits).toEqual(PARSE_WORKER_LIMITS);
    expect(seen.options?.env).toEqual({ NODE_ENV: process.env.NODE_ENV });
  });

  it("galat worker → PARSE_FAILED; log hanya kode dan nama galat, tanpa isi berkas", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await extractUploadTextIsolated("DOCX", enc(SECRET), LIMITS, { spawn: fake(`throw new Error("gagal membaca ${SECRET}")`) });
    expect(r).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).toContain("PARSE_WORKER_ERROR");
  });

  it("pesan worker yang tidak sesuai bentuk, worker keluar tanpa hasil, dan gagal start → PARSE_FAILED", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const post = (v: string) => fake(`require("node:worker_threads").parentPort.postMessage(${v})`);
    expect(await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: post(`{ ok: true, paragraphs: [1], pages: null, chars: 1 }`) })).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: post(`{ ok: false, code: "LENCANA" }`) })).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: post(`"teks"`) })).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: fake("process.exit(0)") })).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: () => { throw new Error("tidak ada berkas worker"); } })).toEqual({ ok: false, code: "PARSE_FAILED" });
  });

  it("worker yang memakai memori berlebih dihentikan pengawas heap → PARSE_FAILED (juga bila NODE_OPTIONS mengalahkan resourceLimits)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hog = fake("const a = []; let i = 0; for (;;) a.push({ s: 'y'.repeat(64) + i++ });");
    const t0 = Date.now();
    expect(await extractUploadTextIsolated("PDF", enc("%PDF-1.4"), { ...LIMITS, timeoutMs: 20_000 }, { spawn: hog, heapCapBytes: 48 * 1024 * 1024 })).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(JSON.stringify(warn.mock.calls)).toMatch(/PARSE_WORKER_MEMORY|PARSE_WORKER_ERROR/);
  }, 30_000);

  it("keluaran konsol worker tidak diteruskan ke stdout/stderr proses utama", async () => {
    const out = vi.spyOn(process.stdout, "write");
    const err = vi.spyOn(process.stderr, "write");
    const chatty = fake(`console.log("${SECRET}"); console.error("${SECRET}"); require("node:worker_threads").parentPort.postMessage({ ok: false, code: "EMPTY_TEXT" })`);
    expect(await extractUploadTextIsolated("TXT", enc(SECRET), LIMITS, { spawn: chatty })).toEqual({ ok: false, code: "EMPTY_TEXT" });
    await new Promise((r) => setTimeout(r, 200));
    expect(JSON.stringify([...out.mock.calls, ...err.mock.calls])).not.toContain(SECRET);
  });

  it("Fix round 1 (M2): paling banyak 2 worker serentak per proses; permintaan lain menunggu ≤ 5 detik lalu BUSY", async () => {
    expect(MAX_PARSE_WORKERS).toBe(2);
    expect(PARSE_QUEUE_WAIT_MS).toBe(5_000);
    // Pengawas heap 256 MB: pengukuran (laporan) PDF 20 halaman + lampiran 3,4 MB memuncak ±19 MB, DOCX/TXT < 7 MB.
    expect(PARSE_WORKER_LIMITS.maxOldGenerationSizeMb).toBe(256);
    expect(UPLOAD_MESSAGES.BUSY).toBe("Sistem sedang memproses berkas lain. Silakan coba lagi sebentar lagi.");
    let started = 0;
    const slow: SpawnParseWorker = (input, options) => {
      started++;
      return fake(`setTimeout(() => require("node:worker_threads").parentPort.postMessage({ ok: false, code: "EMPTY_TEXT" }), 400)`)(input, options);
    };
    const opts = { spawn: slow, queueWaitMs: 150 };
    const all = await Promise.all([1, 2, 3].map(() => extractUploadTextIsolated("TXT", enc("x"), LIMITS, opts)));
    // Dua pertama jalan; yang ketiga menunggu 150 ms (worker masih sibuk 400 ms) lalu BUSY tanpa membuat worker.
    expect(all).toEqual([{ ok: false, code: "EMPTY_TEXT" }, { ok: false, code: "EMPTY_TEXT" }, { ok: false, code: "BUSY" }]);
    expect(started).toBe(2);
    // Slot dibebaskan setelah selesai: antrean yang cukup sabar mendapat giliran.
    const patient = { spawn: slow, queueWaitMs: 2_000 };
    const r = await Promise.all([1, 2, 3].map(() => extractUploadTextIsolated("TXT", enc("x"), LIMITS, patient)));
    expect(r.every((x) => !x.ok && x.code === "EMPTY_TEXT")).toBe(true);
    expect(started).toBe(5);
    // Slot juga dibebaskan saat worker gagal start / timeout.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: () => { throw new Error("x"); } });
    await extractUploadTextIsolated("TXT", enc("x"), { ...LIMITS, timeoutMs: 100 }, { spawn: fake("for (;;) {}") });
    await extractUploadTextIsolated("TXT", enc("x"), { ...LIMITS, timeoutMs: 100 }, { spawn: fake("for (;;) {}") });
    expect(await extractUploadTextIsolated("TXT", enc("x"), LIMITS, { spawn: slow, queueWaitMs: 50 })).toEqual({ ok: false, code: "EMPTY_TEXT" });
  }, 30_000);

  it("runtime unggahan memakai pembaca terisolasi; worker tidak memakai log", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/uploads/runtime.ts", "utf8")).toMatch(/parse: \(kind, bytes, limits\) => extractUploadTextIsolated\(/);
    const worker = readFileSync("src/lib/uploads/parse-worker.ts", "utf8");
    expect(worker).not.toMatch(/console\./);
    expect(readFileSync("src/lib/uploads/parse-isolated.ts", "utf8")).toContain('new Worker(new URL("./parse-worker.ts", import.meta.url)');
  });
});
