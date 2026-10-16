import type { Pool } from "pg";
import { NotFoundError, type DocumentsService } from "@/lib/documents/service";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import { FeatureNotAvailableError } from "./features";

export type ReminderOption = { specId: string; label: string; dueDate: string };

export class InvalidOffsetsError extends Error {
  constructor() {
    super("Offset pengingat tidak valid: pilih 1 sampai 5 hari berbeda, antara 0 dan 365");
    this.name = "InvalidOffsetsError";
  }
}

export interface ReminderService {
  options(userId: string, versionId: string): Promise<ReminderOption[]>;
  set(userId: string, versionId: string, specId: string, offsets: number[], now?: Date): Promise<{ reminderId: string; scheduled: number }>;
  cancel(userId: string, versionId: string, specId: string, now?: Date): Promise<void>;
}

export function createPgReminderService(pool: Pool, docs: DocumentsService): ReminderService {
  async function options(userId: string, versionId: string): Promise<ReminderOption[]> {
    const v = await docs.getVersion(userId, versionId);
    if (!v) throw new NotFoundError();
    // Dokumen unggahan tidak punya tenggat terstruktur.
    if (v.doc.category === "UPLOAD") return [];
    const t = TEMPLATES[v.doc.category];
    return t.reminders.flatMap((r) => {
      const dueDate = r.date(v.structuredData);
      return dueDate ? [{ specId: r.id, label: r.label, dueDate }] : [];
    });
  }

  return {
    options,

    async set(userId, versionId, specId, offsets, now = new Date()) {
      const opt = (await options(userId, versionId)).find((o) => o.specId === specId);
      if (!opt) throw new NotFoundError();
      if (!offsets.every((o) => Number.isInteger(o))) throw new InvalidOffsetsError();
      try {
        const { rows } = await pool.query("select * from set_reminders($1, $2, $3, $4, $5, $6, $7)", [userId, versionId, specId, opt.label, opt.dueDate, offsets, now]);
        return { reminderId: rows[0].reminder_id, scheduled: rows[0].scheduled };
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        if (m.includes("FEATURE_NOT_AVAILABLE")) throw new FeatureNotAvailableError();
        if (m.includes("INVALID_OFFSETS")) throw new InvalidOffsetsError();
        if (m.includes("NOT_FOUND")) throw new NotFoundError();
        throw e;
      }
    },

    async cancel(userId, versionId, specId, now = new Date()) {
      await pool.query("select cancel_reminders($1, $2, $3, $4)", [userId, versionId, specId, now]);
    },
  };
}
