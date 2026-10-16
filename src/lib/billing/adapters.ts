import { randomUUID } from "node:crypto";

export type ChargeInput = { id: string; amountIdr: number };
export type Charge = { providerRef: string; instructions: string };
export interface PaymentAdapter {
  name: "mock" | "manual";
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
export function createManualAdapter(instructions: string | undefined): PaymentAdapter {
  return {
    name: "manual",
    async createCharge() {
      return {
        providerRef: `manual-${randomUUID()}`,
        instructions: instructions?.trim() ? instructions.trim() : "Instruksi pembayaran belum tersedia. Hubungi kami sebelum membayar.",
      };
    },
  };
}
