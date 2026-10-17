// Titik masuk worker_threads untuk membaca berkas unggahan (Task 24, A05). Dibundel terpisah oleh Next (pola
// `new Worker(new URL("./parse-worker.ts", import.meta.url))` di parse-isolated.ts). Hanya menjalankan fungsi murni
// extractUploadText lalu mengirim hasilnya; tidak ada log, jaringan, DB, atau berkas.
import { parentPort, workerData } from "node:worker_threads";
import { extractUploadText, type ParseLimits } from "./parse";
import type { UploadKind } from "./validate";

type Input = { kind: UploadKind; bytes: Uint8Array; limits: ParseLimits };

const input = workerData as Input;
extractUploadText(input.kind, input.bytes, input.limits).then(
  (result) => parentPort?.postMessage(result),
  () => parentPort?.postMessage({ ok: false, code: "PARSE_FAILED" }),
);
