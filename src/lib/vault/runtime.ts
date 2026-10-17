import "server-only";
import { chat } from "@/lib/ai/gateway";
import { createPgAttemptLimiter } from "@/lib/ai/attempts";
import { createPgInflight } from "@/lib/ai/inflight";
import { createPgUsageStore } from "@/lib/ai/quota";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { documentsService } from "@/lib/documents/runtime";
import { createMockEmailSender, type EmailSender } from "./outbox";
import { createPgReminderService } from "./reminders";
import { createPgShareService } from "./share";
import type { ChatTurnDeps } from "@/lib/ai/chat-turn";
import type { ChooserDeps } from "@/lib/ai/template-chooser";
import type { AiReviewDeps } from "@/lib/ai/prereview";
import { createPgVerificationService } from "@/lib/verification/service";
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


export function chatTurnDeps(): ChatTurnDeps {
  return {
    getUserId: async () => {
      const s = await getSessionRoles();
      if (!s) return null;
      if (homeFor(s.roles) !== "/dashboard") throw new ForbiddenError();
      return s.userId;
    },
    service: documentsService(),
    store: createPgUsageStore(getPool()),
    pool: getPool(),
    chat,
    // Satu panggilan AI aktif per pengguna, lintas instance (sewa DB, Task 24 A23).
    inflight: createPgInflight(getPool(), "chat"),
    attempts: createPgAttemptLimiter(getPool()),
  };
}

// Pemilih dokumen "Saya belum tahu" (D-01): sesi, kuota, limiter percobaan, dan gateway sama dengan percakapan dokumen.
export function chooserDeps(): ChooserDeps {
  const base = chatTurnDeps();
  return { getUserId: base.getUserId, store: base.store, pool: getPool(), chat, inflight: createPgInflight(getPool(), "chooser"), attempts: base.attempts };
}

export function aiReviewDeps(): AiReviewDeps {
  const base = chatTurnDeps();
  return {
    getUserId: base.getUserId,
    service: documentsService(),
    store: base.store,
    chat,
    pool: getPool(),
    verification: createPgVerificationService(getPool()),
    inflight: createPgInflight(getPool(), "ai_review"),
    attempts: base.attempts,
  };
}
