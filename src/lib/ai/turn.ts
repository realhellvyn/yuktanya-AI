import type { z } from "zod";
import { GatewayError, MIN_ATTEMPT_MS, type ChatMessage, type chat as gatewayChat } from "./gateway";
import { parseInterviewJson, type InterviewResult } from "./interview";

// Task 24 (A04): tenggat total satu giliran AI (percakapan dokumen, pemilih dokumen, analisis awal), termasuk ulang gateway
// dan perbaikan JSON. Data produksi: p95 28 detik, maks 115 detik. 75 detik memberi ruang satu percobaan lambat (≤ 60 detik)
// atau dua percobaan cepat; di atas itu pengguna lebih baik diberi tahu dan mencoba lagi (kuota dilepas) daripada menunggu
// hingga 4 menit. Rute/aksi yang memanggil AI memakai maxDuration 120 detik agar fungsi tidak dipotong sebelum tenggat ini.
export const TURN_DEADLINE_MS = 75_000;

export const turnDeadline = (clock: () => number = Date.now): number => clock() + TURN_DEADLINE_MS;

// Panggilan pertama + paling banyak dua perbaikan JSON, semuanya di dalam satu tenggat. Perbaikan tidak dimulai bila sisa
// tenggat tidak cukup untuk satu percobaan bermakna. Bila keluaran belum valid KARENA tenggat habis, hasilnya GatewayError
// TIMEOUT (bukan "keluaran rusak") agar pengguna mendapat pesan "AI sedang lambat" dan reservasi kuota dilepas.
export async function chatJsonWithinDeadline<T>(
  chat: typeof gatewayChat,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  deadline: number,
  clock: () => number = Date.now,
): Promise<InterviewResult<T>> {
  const first = await chat(messages, { deadline });
  let timedOut = false;
  const result = await parseInterviewJson(schema, first.text, async (rawText, error) => {
    if (deadline - clock() < MIN_ATTEMPT_MS) {
      timedOut = true;
      throw new GatewayError("TIMEOUT");
    }
    try {
      return (await chat([...messages, { role: "assistant", content: rawText }, { role: "user", content: `Keluaran tidak valid (${error}). Balas ulang HANYA dengan objek JSON yang benar.` }], { deadline })).text;
    } catch (e) {
      if (e instanceof GatewayError && e.code === "TIMEOUT") timedOut = true;
      throw e;
    }
  });
  if (!result.ok && timedOut) throw new GatewayError("TIMEOUT");
  return result;
}
