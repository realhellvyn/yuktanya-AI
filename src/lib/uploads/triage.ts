// Triase awal deterministik (tanpa AI, tanpa kuota). Dokumen bertema berisiko tinggi tidak dianalisis AI dan tidak
// diberi hasil palsu; pengguna diarahkan ke Kasus Hukum Khusus. Daftar ini default rekayasa, menunggu masukan mitra hukum.
export type Triage = { level: "NORMAL" | "HIGH"; reasons: string[] };

const RULES: { reason: string; re: RegExp }[] = [
  { reason: "Pertanahan atau properti bersertifikat", re: /\b(jual\s*beli\s+tanah|hak\s+milik|sertifikat\s+tanah|hak\s+guna\s+bangunan|hak\s+tanggungan|akta\s+jual\s+beli|ppat)\b/i },
  { reason: "Warisan atau hibah", re: /\b(waris(an)?|ahli\s+waris|hibah\s+wasiat|wasiat)\b/i },
  { reason: "Saham, merger, atau akuisisi perusahaan", re: /\b(pengambilalihan\s+saham|akuisisi|merger|penggabungan\s+usaha|jual\s*beli\s+saham)\b/i },
  { reason: "Perkara di pengadilan atau pidana", re: /\b(gugatan|pidana|laporan\s+polisi|somasi|kepailitan|pkpu)\b/i },
  { reason: "Perkawinan atau perceraian", re: /\b(perjanjian\s+pra\s*nikah|perjanjian\s+perkawinan|perceraian|hak\s+asuh)\b/i },
  { reason: "Ketenagakerjaan asing atau lintas negara", re: /\b(tenaga\s+kerja\s+asing|hukum\s+asing|arbitrase\s+internasional)\b/i },
];

export function triageText(paragraphs: string[]): Triage {
  const text = paragraphs.join("\n");
  const reasons = RULES.filter((r) => r.re.test(text)).map((r) => r.reason);
  return { level: reasons.length ? "HIGH" : "NORMAL", reasons };
}
