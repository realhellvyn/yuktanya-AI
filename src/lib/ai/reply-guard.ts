import { formatDateId, formatIdr, parseDateId } from "@/lib/documents/format";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import type { Data, FieldSpec, Template } from "@/lib/documents/types";

// Balasan model hanya teks bebas; yang benar adalah keadaan draf di server. Modul ini (1) membersihkan nama kolom
// internal dan format tanggal mesin, lalu (2) membuang kalimat yang tidak cocok dengan draf akhir: klaim "saya catat …"
// atas nilai yang tidak tersimpan, pertanyaan untuk kolom yang sudah terisi, atau "dokumen siap" padahal belum.
// Yang dibuang diganti kalimat dari keadaan server (yang tercatat + yang masih kosong). Deterministik, tanpa LLM.

// Penanda kalimat yang membicarakan suatu kolom (dipakai untuk pertanyaan dan klaim). Wajib ada untuk setiap kolom.
const SIGNING = /tanggal (perjanjian|surat)|\b(dibuat|ditandatangani|tanda ?tangan|penandatanganan)\b/i;
const COURT = /pengadilan|sengketa/i;
export const FIELD_CUES: Record<string, Record<string, RegExp>> = {
  nda: {
    disclosingParty: /\b(membagikan|pengungkap|pemilik informasi)\b/i,
    receivingParty: /\b(menerima informasi|penerima(nya)?)\b/i,
    signingDate: SIGNING,
    confidentialInfo: /informasi apa|informasi rahasia(nya)? (yang|apa|berupa)|apa (saja )?(informasi|yang (ingin |akan |mau )?(di)?rahasiakan)|yang (ingin |akan |mau )?dirahasiakan|data apa/i,
    purpose: /untuk apa|\btujuan|dipakai untuk|digunakan untuk|keperluan apa|boleh (dipakai|digunakan)/i,
    termMonths: /berapa (lama|bulan|tahun)|jangka waktu|masa (berlaku|kerahasiaan)|berlaku (berapa|selama)/i,
    disputeCity: COURT,
    additionalNotes: /catatan tambahan/i,
  },
  "utang-piutang": {
    creditor: /pemberi pinjaman|\bkredit(u|o)r\b|\b(yang )?meminjamkan\b/i,
    debtor: /\bpeminjam(nya)?\b|\bdebit(u|o)r\b|yang meminjam\b/i,
    signingDate: SIGNING,
    principalIdr: /jumlah (pinjaman|uang)|berapa (jumlah|besar|banyak|nilai)|besar pinjaman|nominal/i,
    dueDate: /lunas|jatuh tempo|dikembalikan|mengembalikan|pelunasan/i,
    disputeCity: COURT,
    repaymentNote: /cara (pembayaran|membayar|bayar|pelunasan)|catatan (cara )?pembayaran|dicicil|\bcicil/i,
  },
  pks: {
    partyA: /pihak pertama/i,
    partyB: /pihak kedua/i,
    signingDate: SIGNING,
    scope: /pekerjaan|ruang lingkup|\blingkup|kerja sama (apa|dalam hal|di bidang)|(bentuk|jenis) kerja sama|\bbidang/i,
    startDate: /\b(mulai|dimulai)\b/i,
    endDate: /berakhir|\bselesai|sampai (kapan|tanggal)/i,
    valueIdr: /\bnilai|berapa (biaya|harga|jumlah)/i,
    paymentDueDays: /berapa hari|hari setelah|tagihan|pembayaran/i,
    disputeCity: COURT,
  },
};

const LABELS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const t of Object.values(TEMPLATES)) for (const f of t.fields) if (!m.has(f.key)) m.set(f.key, f.label);
  return m;
})();
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const keyRe = (k: string) => new RegExp(`(?<![\\p{L}\\p{N}])${k}(?![\\p{L}\\p{N}])`, "gu");

function keysIn(text: string): string[] {
  return [...LABELS.keys()].filter((k) => keyRe(k).test(text));
}

const MACHINE = "(?:YYYY|TTTT)[-/.](?:MM|BB)[-/.](?:DD|HH)";
// Nama kolom → label template; "(kunci)" dihapus; tanggal ISO → "16 Oktober 2026"; "format YYYY-MM-DD" dihapus.
export function sanitizeReply(t: Template, text: string): string {
  let s = text;
  s = s.replace(new RegExp(`\\(\\s*(?:dengan |dalam |pakai )?format\\s+${MACHINE}\\s*\\)`, "gi"), "");
  s = s.replace(new RegExp(`(?:dengan |dalam |pakai )?format\\s+${MACHINE}\\s*[,;]\\s*`, "gi"), "");
  s = s.replace(new RegExp(`,?\\s*(?:dengan |dalam |pakai )?format\\s+${MACHINE}`, "gi"), "");
  s = s.replace(new RegExp(MACHINE, "gi"), "seperti 16 Oktober 2026");
  s = s.replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m) => {
    try {
      return formatDateId(parseDateId(m));
    } catch {
      return m;
    }
  });
  const own = new Map(t.fields.map((f) => [f.key, f.label]));
  for (const k of keysIn(s)) {
    s = s.replace(new RegExp(`\\s*\\(\\s*${k}\\s*\\)`, "gu"), "");
    s = s.replace(keyRe(k), lowerFirst(own.get(k) ?? LABELS.get(k)!));
  }
  return s.replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/ +([,.?!;:)])/g, "$1").replace(/\( +/g, "(").trim();
}

export type ReplyState = {
  template: Template;
  final: Data; // draf setelah giliran ini
  applied: string[]; // kolom yang berubah di giliran ini
  cleared: string[]; // kolom opsional yang dikosongkan
  ready: boolean;
  userText: string; // semua pesan pengguna (riwayat + terbaru)
  noted: boolean; // server menambahkan catatan "Belum tercatat"
  notedKeys?: string[]; // kolom yang sudah dijelaskan di catatan itu (tidak ditanyakan ulang)
};

const READY = /siap dibuat|(sudah|telah) siap|dokumen (anda )?siap|(sudah|telah) lengkap|semua (kolom|data)[^.!?]*(terisi|lengkap)/i;
const CLAIM = /\b(catat|mencatat|dicatat|tercatat|simpan|menyimpan|disimpan|tersimpan|perbarui|memperbarui|diperbarui|ubah|mengubah|diubah|ganti|mengganti|diganti|menangkap|ditangkap|mengerti|isi|mengisi|diisi|terisi|masukkan|memasukkan|dimasukkan)\b/i;
// Penolakan/negasi ("saya tidak bisa mengisi …") bukan klaim mencatat; hanya nilai yang disebut yang diperiksa.
const NEGATION = /\b(tidak|tak|belum|bukan|gagal)\b/i;
// Pertanyaan konfirmasi atau tawaran koreksi tidak meminta nilai baru, jadi tidak dibuang walau kolomnya sudah terisi.
const CONFIRM = /sudah (benar|sesuai|tepat)|\b(benar|sesuai|tepat)\s*\?|apakah [^?]*\b(benar|sesuai|tepat)\b|\b(ingin|perlu|mau)\s+(di)?(koreksi|ubah|ganti|perbaiki)|\bkoreksi\b|\bperbaikan\b/i;
const CORRECTION = /koreksi|\bubah|\bganti|perbaik/i;
const EXAMPLE_START = /^\(?\s*(contoh|misalnya|misal)\b/i;
const ABBREV_END = /(?:^|\s)(rp|no|pn|bpk|pak|bu|dll|dst|mis|yth|sdr|tgl)\.$/i;
const NUMBERING = /^\d{1,2}[.)]\s*/;
const MONTHS = "januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember";
const DATE_TEXT = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})\\b|\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b`, "gi");
const STOP = new Set(
  ("saya anda kamu kak kakak pak bapak bu ibu mas mbak sdr saudara saudari tuan nyonya halo hai baik oke ok terima kasih sudah semua mohon maaf " +
    "ini itu yang dan di ke dari untuk dengan juga lalu kemudian selanjutnya terakhir siap nda pks rp tanggal pengadilan negeri pn kota kabupaten " +
    "perjanjian surat dokumen pihak pertama kedua pemberi pinjaman peminjam informasi rahasia kerahasiaan kerja sama utang piutang contoh catatan " +
    "jika bila kalau apakah berikut data nama yuktanya legal verified " + MONTHS.replace(/\|/g, " ")).split(" "),
);

type Unit = { text: string; sep: string };

// Kalimat + pemisah aslinya; "Rp." dan nomor daftar "1." tidak memutus kalimat; "Contoh: …" menempel ke kalimat sebelumnya.
function splitUnits(text: string): Unit[] {
  const raw = text.split(/((?<=[.!?…])[ \t]+|[ \t]*\n[ \t\n]*)/);
  const units: Unit[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const piece = raw[i];
    const sep = raw[i + 1] ?? "";
    if (!piece) continue;
    const prev = units.at(-1);
    if (prev && (ABBREV_END.test(prev.text) || /^\d{1,2}[.)]$/.test(prev.text) || EXAMPLE_START.test(piece))) {
      prev.text += prev.sep + piece;
      prev.sep = sep;
    } else units.push({ text: piece, sep });
  }
  return units;
}

const blankVal = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
const wholeWord = (needle: string, hay: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(hay);

function mentioned(t: Template, text: string): FieldSpec[] {
  const cues = FIELD_CUES[t.id] ?? {};
  return t.fields.filter((f) => cues[f.key]?.test(text));
}

// Klaim "saya catat …" cocok bila setiap kolom yang disebut terisi dan setiap nilai yang disebut ada di draf akhir.
// Untuk kalimat tanya yang sekaligus mengklaim ("Saya catat X, siapa Y?") hanya nilainya yang diperiksa (cues = false).
function claimConsistent(t: Template, text: string, s: ReplyState, cues = true): boolean {
  if (cues && mentioned(t, text).some((f) => blankVal(s.final[f.key]))) return false;
  const dates = new Set(t.fields.filter((f) => f.kind === "date").map((f) => s.final[f.key]).filter((v): v is string => typeof v === "string"));
  const numbers = new Set(Object.values(s.final).filter((v): v is number => typeof v === "number"));
  const texts = Object.values(s.final).filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  let rest = text;
  for (const m of text.matchAll(DATE_TEXT)) {
    try {
      if (!dates.has(parseDateId(m[1] ? `${m[1]} ${m[2]} ${m[3]}` : `${m[4]}/${m[5]}/${m[6]}`))) return false;
    } catch {
      return false;
    }
    rest = rest.replace(m[0], " ");
  }
  for (const m of rest.matchAll(/(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb)\b/gi)) {
    if (!numbers.has(Math.round(Number(m[1].replace(",", ".")) * (/^(juta|jt)$/i.test(m[2]) ? 1_000_000 : 1_000)))) return false;
    rest = rest.replace(m[0], " ");
  }
  for (const m of rest.matchAll(/Rp\.?\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/gi)) {
    if (!numbers.has(Number(m[1].replace(/\./g, "")))) return false;
    rest = rest.replace(m[0], " ");
  }
  for (const m of rest.matchAll(/\b(\d+)\s+(bulan|hari)\b/gi)) if (!numbers.has(Number(m[1]))) return false;
  // Nama diri (kata berhuruf besar) yang ditulis pengguna tapi tidak ada di draf = klaim atas nilai yang tidak tersimpan.
  const firstWord = /^\P{L}*(\p{L}+)/u.exec(rest)?.[1];
  for (const m of rest.matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)*/gu)) {
    const words = m[0].split(/\s+/);
    while (words.length && STOP.has(words[0].toLowerCase())) words.shift();
    while (words.length && STOP.has(words.at(-1)!.toLowerCase())) words.pop();
    if (!words.length || (words.length === 1 && m.index === rest.indexOf(firstWord ?? "\u0000"))) continue;
    const name = words.join(" ");
    if (wholeWord(name, s.userText) && !texts.some((v) => v.includes(name.toLowerCase()))) return false;
  }
  return true;
}

const shorten = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
function shown(f: FieldSpec, v: string | number): string {
  try {
    if (f.kind === "idr") return formatIdr(Number(v));
    if (f.kind === "date") return formatDateId(String(v));
  } catch {
    /* nilai mentah */
  }
  return shorten(String(v));
}

export const READY_LINE = "Semua kolom wajib sudah terisi. Periksa ringkasan, lalu buat dokumen.";
export const CORRECTION_LINE = "Jika ada yang perlu dikoreksi, sebutkan saja.";

export function reconcileReply(said: string, s: ReplyState): string {
  const t = s.template;
  const units = splitUnits(said.trim());
  // Urutan kalimat asli dipertahankan; null = tempat klaim pertama yang dibuang (diisi daftar dari server).
  const kept: ({ text: string; sep: string } | null)[] = [];
  let changed = false;
  let droppedClaim = false;
  let readySaid = false;
  const asked = new Set<string>();
  const drop = (claim: boolean) => {
    changed = true;
    if (claim && !droppedClaim) kept.push(null);
    if (claim) droppedClaim = true;
  };

  for (const u of units) {
    const hasKey = keysIn(u.text).length > 0;
    const clean = upperFirst(sanitizeReply(t, u.text).replace(NUMBERING, ""));
    if (clean !== u.text) changed = true;
    if (!clean) continue;
    const sep = /\n/.test(u.sep) ? "\n" : " ";
    if (clean.includes("?") && CONFIRM.test(clean)) {
      // konfirmasi/tawaran koreksi: dipertahankan
    } else if (clean.includes("?")) {
      const core = clean.replace(/\((?:[^()]*\b(?:contoh|misalnya|misal)\b[^()]*)\)/gi, " ").replace(/\b(contoh|misalnya|misal)\b[\s\S]*$/i, " ");
      const fields = mentioned(t, core);
      const stale = fields.length > 0 && fields.every((f) => !blankVal(s.final[f.key]));
      const falseClaim = CLAIM.test(core) && !claimConsistent(t, core, s, false);
      if (stale || falseClaim) {
        drop(falseClaim);
        continue;
      }
      for (const f of fields) if (f.required && blankVal(s.final[f.key])) asked.add(f.key);
    } else if (READY.test(clean) && NEGATION.test(clean)) {
      // "dokumen belum siap": benar hanya bila memang belum siap.
      if (s.ready) {
        drop(false);
        continue;
      }
    } else if (READY.test(clean)) {
      if (!s.ready || (CLAIM.test(clean) && !claimConsistent(t, clean, s))) {
        drop(false);
        continue;
      }
      readySaid = true;
    } else if (CLAIM.test(clean) && (hasKey || !claimConsistent(t, clean, s, !NEGATION.test(clean)))) {
      drop(true);
      continue;
    }
    kept.push({ text: clean, sep });
  }

  let confirmation = "";
  const anyKept = kept.some((k) => k !== null);
  if (droppedClaim || (!anyKept && s.applied.length > 0)) {
    const byKey = new Map(t.fields.map((f) => [f.key, f]));
    const items = s.applied.filter((k) => !s.cleared.includes(k) && !blankVal(s.final[k]) && byKey.has(k)).map((k) => `${byKey.get(k)!.label}: ${shown(byKey.get(k)!, s.final[k])}`);
    const parts: string[] = [];
    if (items.length) parts.push(`Yang tercatat dari pesan ini: ${items.join("; ")}.`);
    if (s.cleared.length) parts.push(`Dikosongkan: ${s.cleared.map((k) => byKey.get(k)?.label ?? "").filter(Boolean).join(", ")}.`);
    if (!parts.length && !s.noted) parts.push("Belum ada data baru yang tercatat dari pesan ini.");
    confirmation = parts.join(" ");
    if (!droppedClaim && confirmation) kept.unshift(null);
  }
  const ask: string[] = [];
  const missing = t.fields.filter((f) => f.required && blankVal(s.final[f.key]) && !(s.notedKeys ?? []).includes(f.key));
  if (!s.ready && missing.length > 0 && !missing.some((f) => asked.has(f.key))) {
    for (const f of missing.slice(0, 2)) ask.push(`${f.label}? ${f.example ?? ""}`.trim());
  }
  const tail = s.ready && !readySaid ? [READY_LINE] : [];
  if (s.ready && !kept.some((k) => k && CORRECTION.test(k.text))) tail.push(CORRECTION_LINE);
  if (!changed && !confirmation && ask.length === 0 && tail.length === 0) return said.trim();
  let body = "";
  for (const k of kept) {
    if (k === null) body += confirmation ? `${confirmation}\n` : "";
    else body += `${k.text}${k.sep}`;
  }
  return [body.trim(), ...ask, ...tail].filter(Boolean).join("\n").slice(0, 3000);
}
