import type { Category, Template } from "../types";
import { nda } from "./nda";
import { pks } from "./pks";
import { utangPiutang } from "./utang-piutang";

export const TEMPLATES: Record<Category, Template> = { NDA: nda, PKS: pks, UTANG_PIUTANG: utangPiutang };

export class TemplateNotApprovedError extends Error {
  constructor(category: string) {
    super(`Template ${category} belum disetujui`);
    this.name = "TemplateNotApprovedError";
  }
}

export type ApprovalCheck = (templateId: string, version: number, contentHash: string) => Promise<boolean>;

// Produksi hanya memakai template APPROVED yang hash-nya sama dengan kode; selain itu ditolak.
export async function getTemplate(
  category: Category,
  opts: { allowUnapproved: boolean; isApproved: ApprovalCheck },
): Promise<{ template: Template; approval: "APPROVED" | "DRAFT" }> {
  const template = TEMPLATES[category];
  if (await opts.isApproved(template.id, template.version, template.contentHash())) return { template, approval: "APPROVED" };
  if (opts.allowUnapproved) return { template, approval: "DRAFT" };
  throw new TemplateNotApprovedError(category);
}
