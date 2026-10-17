import { randomUUID } from "node:crypto";
import { createSnapTransaction, ITEM_NAMES, type MidtransConfig } from "./midtrans";

export type ChargeInput = { id: string; amountIdr: number; kind?: string; expiresAt?: Date; now?: Date };
// redirectUrl: halaman bayar penyedia (hanya adaptor hosted). Disimpan bersama pembayaran agar klik ulang memakai yang sama.
export type Charge = { providerRef: string; instructions: string; redirectUrl?: string };
export type ProviderName = "mock" | "manual" | "midtrans";
export interface PaymentAdapter {
  name: ProviderName;
  // Hosted: pengguna membayar di halaman penyedia; pembayaran baru dicatat setelah penyedia membuat transaksi.
  hosted?: boolean;
  // Hosted: asal halaman bayar yang aktif. URL tersimpan dari asal lain (mis. Sandbox setelah pindah ke Production) tidak dipakai ulang.
  redirectOrigins?: string[];
  createCharge(order: ChargeInput): Promise<Charge>;
}

// Hanya untuk pengembangan dan tes; rute settle mock menolak di produksi.
export function createMockAdapter(): PaymentAdapter {
  return {
    name: "mock",
    async createCharge() {
      return { providerRef: `mock-${randomUUID()}`, instructions: "Pembayaran simulasi. Tidak ada uang yang dipindahkan." };
    },
  };
}

// Transfer bank manual: platform admin mengonfirmasi dengan referensi bank. Teks instruksi dari env (kosong → belum tersedia).
// Sejak Task 21 tidak lagi ditawarkan ke pengguna; tetap terdaftar agar pembayaran manual lama dapat diselesaikan admin.
export function createManualAdapter(instructions: string | undefined): PaymentAdapter {
  return {
    name: "manual",
    async createCharge() {
      return {
        providerRef: `manual-${randomUUID()}`,
        instructions: instructions?.trim() ? instructions.trim() : "Instruksi pembayaran belum tersedia. Jangan melakukan pembayaran sebelum instruksi tersedia.",
      };
    },
  };
}

// Midtrans Snap (mode redirect). order_id Midtrans = provider_ref acak `ytk-<uuid>` (41 karakter, ≤50); jumlah dari server.
export function createMidtransAdapter(cfg: MidtransConfig, appOrigin: () => string, fetchImpl: typeof fetch = fetch): PaymentAdapter {
  return {
    name: "midtrans",
    hosted: true,
    redirectOrigins: cfg.redirectOrigins,
    async createCharge(order) {
      const providerRef = `ytk-${randomUUID()}`;
      const now = order.now ?? new Date();
      const snap = await createSnapTransaction(cfg, {
        providerRef, amountIdr: order.amountIdr, itemId: order.kind ?? "ORDER", itemName: ITEM_NAMES[order.kind ?? ""] ?? "Layanan Yuktanya",
        finishUrl: `${appOrigin()}/checkout/${order.id}`, expiresAt: order.expiresAt ?? new Date(now.getTime() + 24 * 3600_000), now,
      }, fetchImpl);
      return { providerRef, instructions: "", redirectUrl: snap.redirectUrl };
    },
  };
}
