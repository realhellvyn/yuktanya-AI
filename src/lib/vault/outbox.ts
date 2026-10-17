import type { Pool } from "pg";
import { formatDateId } from "@/lib/documents/format";

export type EmailMessage = { to: string; subject: string; text: string };
export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

// Pengirim mock untuk pengembangan dan tes. Penyedia email nyata belum dipilih (UNKNOWN).
export function createMockEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sent, async send(msg) { sent.push(msg); } };
}

type Row = { id: string; kind: string; payload: Record<string, unknown>; attempts: number; claim_token: string };

function render(row: Row): EmailMessage {
  const p = row.payload;
  if (row.kind === "ack_code") {
    return {
      to: String(p.to),
      subject: "Kode konfirmasi baca Yuktanya",
      text: `Kode konfirmasi baca Anda: ${String(p.code)}\nKode berlaku 10 menit. Konfirmasi baca hanya menyatakan Anda sudah membaca versi dokumen ini dan bukan tanda tangan elektronik.\nBila Anda tidak meminta kode ini, abaikan email ini.`,
    };
  }
  if (row.kind === "reminder") {
    return {
      to: String(p.to),
      subject: `Pengingat: ${String(p.label)}`,
      text: `${String(p.label)} jatuh tempo pada ${formatDateId(String(p.due_date))}.\nBuka Yuktanya untuk melihat dokumen Anda.`,
    };
  }
  throw new Error(`Jenis outbox tidak dikenal: ${row.kind}`);
}

const DEFAULT_SEND_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("send timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// Klaim bertoken → render → kirim (dengan batas waktu) → tandai. Gagal: dijadwalkan ulang (5 menit × percobaan), FAILED setelah 5 percobaan.
// Kode konfirmasi yang sudah kedaluwarsa dibatalkan, bukan dikirim terlambat. Setelah kirim berhasil, kegagalan menandai SENT tidak
// dihitung sebagai gagal kirim (agar tidak terkirim ulang).
export async function processOutbox(
  pool: Pool,
  sender: EmailSender,
  now: Date = new Date(),
  limit = 20,
  opts: { sendTimeoutMs?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const timeoutMs = opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const { rows } = await pool.query<Row>("select id, kind, payload, attempts, claim_token from claim_outbox($1, $2, 120)", [now, limit]);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.kind === "ack_code") {
      const exp = Date.parse(String(row.payload.expires_at));
      if (!Number.isNaN(exp) && exp <= now.getTime()) {
        await pool.query("select cancel_outbox($1, $2)", [row.id, row.claim_token]);
        continue;
      }
    }
    try {
      await withTimeout(sender.send(render(row)), timeoutMs);
    } catch (e) {
      failed++;
      const retryAt = new Date(now.getTime() + 5 * 60_000 * row.attempts);
      await pool.query("select fail_outbox($1, $2, $3, $4)", [row.id, row.claim_token, e instanceof Error ? e.message : "error", retryAt]);
      continue;
    }
    sent++;
    await pool.query("select complete_outbox($1, $2)", [row.id, row.claim_token]);
  }
  return { sent, failed };
}
