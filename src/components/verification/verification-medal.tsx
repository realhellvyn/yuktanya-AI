import { cn } from "@/lib/utils";
import { MEDAL_TEXT, type MedalNote, type MedalTier } from "@/lib/verification/medal";

// Lencana medali bertingkat (Task 20, keputusan pemilik 17 Okt 2026; desain dan teks dari brief mitra hukum).
// Medali = cincin logam + bidang dalam + mark small Yuktanya (path persis dari public/brand/yuktanya-mark-small-navy.svg),
// SELALU dengan tulisan tingkat di bawahnya. Grafis aria-hidden; makna dibawa tulisan yang terbaca pembaca layar.
// Komponen ini tidak memutuskan apa pun: pemanggil memilih tingkat lewat medalFor() dari status server yang sudah ada.
// Jangan dipakai sebagai logo atau hiasan (diuji: hanya di tampilan verifikasi yang tercatat).
//
// Palet datar 3 nada per logam (tanpa gradien agar tajam di 32px). Tepi (edge) ≥3:1 terhadap bg dan surface, mark navy
// ≥3:1 terhadap bidang dalam (face); diuji di tests/unit/verification-medal.test.tsx. Gold memakai warna identitas gold
// sebagai isi cincin grafis bertepi gelap (bukan teks) atas keputusan pemilik 17 Okt 2026.
export const MEDAL_PALETTE = {
  bronze: { face: "#F0D2B4", ring: "#A86B3C", edge: "#7A4A26" },
  silver: { face: "#EEF0F3", ring: "#C7CCD3", edge: "#6B7480" },
  gold: { face: "#F6E3BF", ring: "#D4A66A", edge: "#8A6420" },
} as const satisfies Record<MedalTier, { face: string; ring: string; edge: string }>;
const MARK_INK = "#0D1B2A"; // navy
// Path mark small dari brand kit (tidak digambar ulang): perisai berlubang (evenodd) + huruf Y.
export const MARK_PATHS = [
  "M60 3C46 12 28 19 6 22L6 54C6 88 30 112 60 129C90 112 114 88 114 54L114 22C92 19 74 12 60 3Z M60 18C49 24 36 29 21 32L21 54C21 80 38 98 60 111C82 98 99 80 99 54L99 32C84 29 71 24 60 18Z",
  "M30 40C38 39 45 41 50 45L60 57L70 45C75 41 82 39 90 40C84 47 77 56 71 65L71 118L49 118L49 65C43 56 36 47 30 40Z",
] as const;

// Bentuk medali di kotak 64×64. Gold: cincin ganda (garis tepi tambahan) agar tingkat tertinggi terbaca dari bentuknya juga.
function MedalShapes({ tier }: { tier: MedalTier }) {
  const p = MEDAL_PALETTE[tier];
  const gold = tier === "gold";
  return (
    <>
      <circle cx="32" cy="32" r="30.5" fill={p.ring} stroke={p.edge} strokeWidth="2" />
      {gold && <circle cx="32" cy="32" r="26.75" fill="none" stroke={p.edge} strokeWidth="1.5" />}
      <circle cx="32" cy="32" r={gold ? 23 : 23.5} fill={p.face} stroke={p.edge} strokeWidth="1.5" />
      <g transform="translate(15.2 13.52) scale(0.28)" fill={MARK_INK}>
        <path fillRule="evenodd" d={MARK_PATHS[0]} />
        <path d={MARK_PATHS[1]} />
      </g>
    </>
  );
}

const SIZE = { sm: "h-8 w-8", md: "h-14 w-14", lg: "h-20 w-20" } as const;

export function VerificationMedal({ tier, note, size = "md", className }: { tier: MedalTier; note?: MedalNote; size?: keyof typeof SIZE; className?: string }) {
  const text = MEDAL_TEXT[tier];
  return (
    <div data-medal={tier} className={cn("inline-flex max-w-full flex-col items-center gap-1.5 text-center", className)}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 64 64" className={cn("shrink-0", SIZE[size])}>
        <MedalShapes tier={tier} />
      </svg>
      <span className="flex flex-col">
        <span className="font-bold leading-snug text-heading">{text.label}</span>
        <span className="text-[15px] leading-snug text-muted">{note ?? text.note}</span>
      </span>
    </div>
  );
}

// Salinan SVG mandiri untuk dokumentasi (public/brand/medals/medal-<tingkat>.svg), lengkap dengan tulisan tingkatnya.
// Dibuat ulang dengan UPDATE_MEDALS=1 npx vitest run tests/unit/verification-medal.test.tsx; tidak dipakai di halaman.
export function MedalStaticSvg({ tier }: { tier: MedalTier }) {
  const text = MEDAL_TEXT[tier];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 136" role="img" aria-label={`Contoh medali ${text.label}: ${text.note}`}>
      <g transform="translate(80 2) scale(1.25)">
        <MedalShapes tier={tier} />
      </g>
      <text x="120" y="104" textAnchor="middle" fontFamily="'Plus Jakarta Sans', system-ui, sans-serif" fontSize="16" fontWeight="700" fill={MARK_INK}>{text.label}</text>
      <text x="120" y="124" textAnchor="middle" fontFamily="'Plus Jakarta Sans', system-ui, sans-serif" fontSize="13" fill="#5B5A55">{text.note}</text>
    </svg>
  );
}
