import "server-only";
import { chat } from "@/lib/ai/gateway";
import { createPgAttemptLimiter } from "@/lib/ai/attempts";
import { createPgUsageStore } from "@/lib/ai/quota";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { documentsService } from "@/lib/documents/runtime";
import { createMockEmailSender, type EmailSender } from "./outbox";
import { createRateLimiter } from "./rate-limit";
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

export const publicLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
export const ackLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

const chatInflight = new Set<string>();
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
    inflight: chatInflight,
    attempts: createPgAttemptLimiter(getPool()),
  };
}

// Pemilih dokumen "Saya belum tahu" (D-01): sesi, kuota, limiter percobaan, dan gateway sama dengan percakapan dokumen.
const chooserInflight = new Set<string>();
export function chooserDeps(): ChooserDeps {
  const base = chatTurnDeps();
  return { getUserId: base.getUserId, store: base.store, pool: getPool(), chat, inflight: chooserInflight, attempts: base.attempts };
}

const aiReviewInflight = new Set<string>();
export function aiReviewDeps(): AiReviewDeps {
  const base = chatTurnDeps();
  return {
    getUserId: base.getUserId,
    service: documentsService(),
    store: base.store,
    chat,
    pool: getPool(),
    verification: createPgVerificationService(getPool()),
    inflight: aiReviewInflight,
    attempts: base.attempts,
  };
}
