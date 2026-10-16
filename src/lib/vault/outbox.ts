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

type Row = { id: string; kind: string; payload: Record<string, unknown>; attempts: number };

function render(row: Row): EmailMessage {
  const p = row.payload;
  if (row.kind === "ack_code") {
    return {
      to: String(p.to),
      subject: "Kode konfirmasi baca Yuktanya",
      text: `Kode konfirmasi baca Anda: ${String(p.code)}\nKode berlaku 10 menit. Konfirmasi baca hanya menyatakan Anda sudah membaca versi dokumen ini dan bukan tanda tangan elektronik.\nJika bukan Anda yang meminta, abaikan email ini.`,
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

// Klaim dengan lease → render → kirim → tandai. Gagal: dijadwalkan ulang (5 menit × percobaan), FAILED setelah 5 percobaan.
export async function processOutbox(pool: Pool, sender: EmailSender, now: Date = new Date(), limit = 20): Promise<{ sent: number; failed: number }> {
  const { rows } = await pool.query<Row>("select id, kind, payload, attempts from claim_outbox($1, $2, 120)", [now, limit]);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sender.send(render(row));
      await pool.query("select complete_outbox($1)", [row.id]);
      sent++;
    } catch (e) {
      failed++;
      const retryAt = new Date(now.getTime() + 5 * 60_000 * row.attempts);
      await pool.query("select fail_outbox($1, $2, $3)", [row.id, e instanceof Error ? e.message : "error", retryAt]);
    }
  }
  return { sent, failed };
}
