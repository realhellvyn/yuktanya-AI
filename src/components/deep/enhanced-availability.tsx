import { ENHANCED_RUBRIC_PENDING } from "@/lib/copy";

// Pemberitahuan jujur bila rubrik Enhanced belum disetujui (nilai dari server: deepService().rubricApproved()).
// Rubrik sudah disetujui → tidak menampilkan apa pun, teks tawaran seperti biasa.
export function EnhancedRubricNotice({ rubricApproved }: { rubricApproved: boolean }) {
  if (rubricApproved) return null;
  return <p role="note" data-enhanced-pending className="rounded-xl border border-amber-400 bg-amber-50 p-3 font-semibold text-amber-900">{ENHANCED_RUBRIC_PENDING}</p>;
}
