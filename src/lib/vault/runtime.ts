import "server-only";
import { chat } from "@/lib/ai/gateway";
import { createPgUsageStore } from "@/lib/ai/quota";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { documentsService } from "@/lib/documents/runtime";
import { createMockEmailSender, type EmailSender } from "./outbox";
import { createRateLimiter } from "./rate-limit";
import { createPgReminderService } from "./reminders";
import { createPgShareService } from "./share";
import type { AssistDeps } from "@/lib/ai/assist";
import { getSessionRoles } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/documents/handlers";

let share: ReturnType<typeof createPgShareService> | undefined;
export const shareService = () => (share ??= createPgShareService(getPool()));
let reminders: ReturnType<typeof createPgReminderService> | undefined;
export const reminderService = () => (reminders ??= createPgReminderService(getPool(), documentsService()));
export const evidenceDeps = () => ({ pool: getPool(), blob: getBlobStore() });

// Penyedia email nyata belum dipilih (UNKNOWN): di produksi tidak ada pengirim sehingga rute cron menolak (503).
const mock = createMockEmailSender();
export const emailSender = (): EmailSender | null => (process.env.NODE_ENV === "production" ? null : mock);

export const publicLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
export const ackLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

const assistInflight = new Set<string>();
export function assistDeps(): AssistDeps {
  return {
    getUserId: async () => {
      const s = await getSessionRoles();
      if (!s) return null;
      if (homeFor(s.roles) !== "/dashboard") throw new ForbiddenError();
      return s.userId;
    },
    service: documentsService(),
    store: createPgUsageStore(getPool()),
    chat,
    inflight: assistInflight,
  };
}
