import type { Block, RenderedDoc } from "@/lib/documents/render";

export const UPLOAD_TEMPLATE_ID = "upload";
export const UPLOAD_DOC_LABEL = "Dokumen unggahan Anda (teks hasil pembacaan berkas). Belum diperiksa oleh profesional hukum.";

// Judul aman dari nama berkas: tanpa ekstensi, pemisah menjadi spasi, dipotong 120 karakter.
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]+$/, "");
  const t = base.replace(/[_\-.]+/g, " ").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120).trim();
  return t || "Dokumen unggahan";
}

// Teks unggahan disimpan sebagai RenderedDoc kanonik sehingga pratinjau, AI, dan pemeriksa membaca byte beku yang sama.
export function uploadedDoc(title: string, paragraphs: string[]): RenderedDoc {
  const blocks: Block[] = [{ id: "title", kind: "title", text: title }, ...paragraphs.map((text, i): Block => ({ id: `p${i + 1}`, kind: "paragraph", text }))];
  return { templateId: UPLOAD_TEMPLATE_ID, templateVersion: 1, category: "UPLOAD", approval: "DRAFT", label: UPLOAD_DOC_LABEL, blocks };
}
