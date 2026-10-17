import "server-only";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { PARSE_TIMEOUT_MS } from "./limits";
import { logUploadIssue } from "./log";
import type { ParseCode, ParseLimits, ParseResult } from "./parse";
import type { UploadKind } from "./validate";

// Task 24 (A05): pembacaan PDF/DOCX/TXT dijalankan di worker_threads terpisah dengan batas waktu KERAS. Satu halaman PDF yang
// berat di pdf.js (kerja sinkron) tidak dapat dipotong di dalam proses; worker dapat dihentikan (terminate) kapan saja.
// - Lewat PARSE_TIMEOUT_MS: worker dihentikan → { ok: false, code: "TIMEOUT" }.
// - Galat/keluar/kehabisan memori worker → PARSE_FAILED. Pesan galat TIDAK dicatat (dapat memuat potongan isi); hanya nama.
// - stdout/stderr worker tidak diteruskan ke log proses (dibuang), jadi teks berkas tidak pernah sampai ke log.
// - Memori worker dibatasi dua lapis: resourceLimits, DAN pengawas heap di proses utama (worker.getHeapStatistics tiap 100 ms).
//   Lapis kedua perlu karena NODE_OPTIONS=--max-old-space-size (bendera V8 global proses) mengalahkan resourceLimits worker;
//   terbukti di lingkungan pengembangan (heap worker tumbuh > 2 GB walau batas 16 MB). Lewat batas → PARSE_FAILED.
// - Env worker hanya NODE_ENV (rahasia server tidak terlihat oleh pembaca berkas).
export const PARSE_WORKER_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } as const;
const HEAP_CAP_BYTES = PARSE_WORKER_LIMITS.maxOldGenerationSizeMb * 1024 * 1024;
const HEAP_POLL_MS = 100;

export type WorkerInput = { kind: UploadKind; bytes: Uint8Array; limits: ParseLimits };
export type SpawnParseWorker = (input: WorkerInput, options: WorkerOptions) => Worker;

// Bentuk literal ini wajib: bundler Next mengenali `new Worker(new URL("./…", import.meta.url))` dan membundel worker
// beserta dependensinya (unpdf, jszip) sebagai berkas tersendiri di build produksi.
const spawnDefault: SpawnParseWorker = (input, options) =>
  new Worker(new URL("./parse-worker.ts", import.meta.url), { ...options, workerData: input });

const CODES = new Set<ParseCode>(["PARSE_FAILED", "ENCRYPTED", "SCANNED_PDF", "TOO_MANY_PAGES", "TOO_LONG", "EMPTY_TEXT", "ZIP_LIMIT", "DOCX_TOO_LARGE", "TIMEOUT"]);

// Pesan dari worker diperiksa bentuknya; apa pun yang tidak sesuai dianggap PARSE_FAILED.
function asResult(m: unknown): ParseResult | null {
  if (!m || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  if (r.ok === false) return typeof r.code === "string" && CODES.has(r.code as ParseCode) ? { ok: false, code: r.code as ParseCode } : null;
  if (r.ok !== true || !Array.isArray(r.paragraphs) || !r.paragraphs.every((p) => typeof p === "string")) return null;
  if (typeof r.chars !== "number" || !(r.pages === null || typeof r.pages === "number")) return null;
  return { ok: true, paragraphs: r.paragraphs as string[], pages: r.pages as number | null, chars: r.chars };
}

export async function extractUploadTextIsolated(
  kind: UploadKind,
  bytes: Uint8Array,
  limits: ParseLimits,
  opts: { spawn?: SpawnParseWorker; heapCapBytes?: number } = {},
): Promise<ParseResult> {
  const timeout = limits.timeoutMs ?? PARSE_TIMEOUT_MS;
  const options: WorkerOptions = { resourceLimits: { ...PARSE_WORKER_LIMITS }, stdout: true, stderr: true, env: { NODE_ENV: process.env.NODE_ENV } };
  let worker: Worker;
  try {
    worker = (opts.spawn ?? spawnDefault)({ kind, bytes, limits }, options);
  } catch (e) {
    logUploadIssue("upload", "PARSE_WORKER_START", e);
    return { ok: false, code: "PARSE_FAILED" };
  }
  // Keluaran konsol worker dibuang (tidak pernah ditulis ke log).
  worker.stdout?.resume();
  worker.stderr?.resume();
  return new Promise<ParseResult>((resolve) => {
    let done = false;
    const finish = (r: ParseResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      worker.removeAllListeners("message");
      void worker.terminate().catch(() => undefined);
      resolve(r);
    };
    // Batas keras: pembacaan di dalam worker juga punya tenggat kooperatif dengan nilai sama (TIMEOUT dari worker sendiri);
    // pewaktu ini menghentikan worker yang macet di kerja sinkron.
    const timer = setTimeout(() => {
      logUploadIssue("upload", "TIMEOUT");
      finish({ ok: false, code: "TIMEOUT" });
    }, timeout);
    const cap = opts.heapCapBytes ?? HEAP_CAP_BYTES;
    const watch = setInterval(() => {
      // getHeapStatistics ada sejak Node 22.16; galat (worker belum/sudah tidak berjalan) diabaikan.
      worker.getHeapStatistics?.().then((h) => {
        if (h.used_heap_size > cap) {
          logUploadIssue("upload", "PARSE_WORKER_MEMORY");
          finish({ ok: false, code: "PARSE_FAILED" });
        }
      }, () => undefined);
    }, HEAP_POLL_MS);
    worker.once("message", (m) => finish(asResult(m) ?? { ok: false, code: "PARSE_FAILED" }));
    worker.once("error", (e) => {
      logUploadIssue("upload", "PARSE_WORKER_ERROR", e);
      finish({ ok: false, code: "PARSE_FAILED" });
    });
    worker.once("exit", () => finish({ ok: false, code: "PARSE_FAILED" }));
  });
}
