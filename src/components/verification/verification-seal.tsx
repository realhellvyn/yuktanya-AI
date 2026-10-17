// Lencana visual status verifikasi (brand kit LencanaVerifikasi): lingkaran, BUKAN perisai, agar tidak tertukar dengan logo.
// Hanya hiasan (aria-hidden): makna selalu dibawa teks status di sebelahnya. Status berasal dari server; komponen ini tidak
// memutuskan apa pun, pemanggil yang memilih varian dari status yang sudah ada.
// - "verified": lingkaran success dengan centang (Legal Verified/Enhanced berstatus Aktif).
// - "unreviewed": lingkaran bergaris putus-putus tanpa centang (belum diperiksa profesional, mis. AI Verified).
export function VerificationSeal({ variant, className = "h-10 w-10" }: { variant: "verified" | "unreviewed"; className?: string }) {
  return variant === "verified" ? (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={`shrink-0 ${className}`} data-seal="verified">
      <circle cx="20" cy="20" r="19" fill="var(--success)" />
      <path d="M12 20.5l5.5 5.5L28.5 14" fill="none" stroke="var(--surface)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={`shrink-0 ${className}`} data-seal="unreviewed">
      <circle cx="20" cy="20" r="18" fill="none" stroke="var(--border-strong)" strokeWidth="2" strokeDasharray="4 4" />
    </svg>
  );
}
