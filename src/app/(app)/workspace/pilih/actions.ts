"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { chooseTemplateTurn, type ChooserChoice, type ChooserErrorCode, type ChooserTurn } from "@/lib/ai/template-chooser";
import { chooserDeps } from "@/lib/vault/runtime";

export type ChooserState = { lines: ChooserTurn[]; choice: ChooserChoice | null; notice: string | null; key: string; draft: string };

// Kode galat → kalimat tetap (tidak ada teks dari klien atau model yang dipakai sebagai pesan sistem).
const NOTICE: Partial<Record<ChooserErrorCode, string>> = {
  AI_MESSAGE_QUOTA_REACHED: "Kuota pesan AI hari ini sudah habis. Pesan terakhir Anda belum terkirim. Anda tetap dapat memilih dokumen sendiri di halaman Buat Dokumen. Kuota diperbarui pukul 00.00 WIB.",
  AI_UNAVAILABLE: "Layanan AI sedang sibuk. Kuota AI Anda tidak terpakai, dan tulisan Anda masih ada di kotak pesan. Tekan Kirim lagi, atau pilih dokumen sendiri.",
  AI_TIMEOUT: "AI sedang lambat. Pesan Anda belum diproses dan kuota AI Anda tidak terpakai. Tulisan Anda masih ada di kotak pesan. Tekan Kirim lagi, atau pilih dokumen sendiri.",
  AI_BUSY: "Pesan sebelumnya masih diproses. Tunggu sebentar, lalu kirim lagi.",
  DUPLICATE_REQUEST: "Pesan ini sudah diproses. Bila balasannya belum tampil, kirim lagi.",
  TOO_MANY_ATTEMPTS: "Terlalu banyak percobaan dalam waktu singkat. Tunggu satu menit, lalu kirim lagi.",
  INVALID_REQUEST: "Pesan belum dapat diproses. Tulis pesan Anda (paling banyak 2.000 karakter), lalu kirim lagi.",
};
const FALLBACK = "Pesan belum dapat diproses. Coba lagi beberapa saat lagi, atau pilih dokumen sendiri.";

export async function chooseTemplateAction(prev: ChooserState, formData: FormData): Promise<ChooserState> {
  const message = String(formData.get("message") ?? "");
  const key = String(formData.get("key") ?? "");
  // Riwayat dari klien hanya konteks percakapan; pilihan tetap divalidasi terhadap registri di server.
  const lines = Array.isArray(prev?.lines) ? prev.lines.slice(-40) : [];
  const r = await chooseTemplateTurn(chooserDeps(), { message, key, history: lines.slice(-12) });
  if (r.ok) {
    return {
      lines: [...lines, { role: "user" as const, content: message.trim() }, { role: "assistant" as const, content: r.reply }].slice(-40),
      choice: r.choice, notice: null, key: randomUUID(), draft: "",
    };
  }
  if (r.code === "AUTH_REQUIRED") redirect("/login?returnTo=%2Fworkspace%2Fpilih");
  if (r.code === "FORBIDDEN") redirect("/dashboard");
  return { lines, choice: prev?.choice ?? null, notice: NOTICE[r.code] ?? FALLBACK, key: randomUUID(), draft: message.slice(0, 2000) };
}
