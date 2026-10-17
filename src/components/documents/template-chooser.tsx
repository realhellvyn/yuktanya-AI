"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ChooserState } from "@/app/(app)/workspace/pilih/actions";
import type { Category } from "@/lib/documents/types";
import { SlowProgress } from "./slow-progress";

type Option = { category: Category; title: string; text: string };
type Props = {
  options: Option[];
  initialKey: string;
  chooseAction: (prev: ChooserState, formData: FormData) => Promise<ChooserState>;
  createAction: (formData: FormData) => Promise<void>;
  specialCaseNote: string;
};

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="min-h-[52px] rounded-xl bg-primary px-6 text-lg font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
      {pending ? "AI sedang berpikir…" : "Kirim"}
    </button>
  );
}

const GREETING = "Selamat datang. Ceritakan keperluan Anda dengan bahasa sehari-hari, misalnya “Saya mau meminjamkan uang ke saudara” atau “Saya mau bekerja sama membuka warung”. Saya akan menyarankan dokumen yang sesuai.";

// Percakapan "Saya belum tahu" (D-01). Saran hanya tampil untuk dokumen dari katalog server; memulai dokumen tetap lewat
// aksi pembuatan dokumen biasa, lalu berlanjut di percakapan dokumen.
export function TemplateChooser({ options, initialKey, chooseAction, createAction, specialCaseNote }: Props) {
  const [state, formAction] = useActionState(chooseAction, { lines: [], choice: null, notice: null, key: initialKey, draft: "" });
  const end = useRef<HTMLDivElement>(null);
  // Badan blok: Chrome 149/150+ mengembalikan Promise dari scrollIntoView; bila dikembalikan, React memanggilnya sebagai
  // cleanup pada balasan berikutnya ("i is not a function", Task 17).
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.lines.length]);
  const suggested = options.find((o) => o.category === state.choice);
  return (
    <section aria-label="Percakapan memilih dokumen" className="space-y-4">
      <ol className="space-y-3" aria-live="polite" aria-relevant="additions">
        <li className="max-w-[92%] rounded-2xl rounded-tl-sm border border-line bg-surface p-4"><span className="sr-only">AI: </span>{GREETING}</li>
        {state.lines.map((m, i) => (
          <li key={i} className={m.role === "user" ? "ml-auto max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-tint p-4 ring-1 ring-line" : "max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-line bg-surface p-4"}>
            <span className="sr-only">{m.role === "user" ? "Anda: " : "AI: "}</span>{m.content}
          </li>
        ))}
      </ol>
      <div ref={end} />
      {state.notice && (
        <p role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold">
          {state.notice} <Link className="inline-flex min-h-12 items-center underline" href="/workspace/new">Pilih dokumen sendiri</Link>
        </p>
      )}
      {suggested && (
        <div data-testid="saran-dokumen" className="space-y-3 rounded-2xl border border-border-strong bg-tint p-5">
          <p className="text-lg font-bold text-navy">Saran AI: {suggested.title}</p>
          <p>Dokumen ini {suggested.text}. AI akan menanyakan detail dokumen satu per satu. Setiap jawaban tersimpan otomatis.</p>
          <form action={createAction}>
            <input type="hidden" name="category" value={suggested.category} />
            <button type="submit" className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-primary px-6 text-lg font-semibold text-on-primary hover:bg-primary-hover">Mulai {suggested.title}</button>
          </form>
          <p className="text-muted">Bukan dokumen ini? Ceritakan lebih rinci di bawah, atau <Link className="inline-flex min-h-12 items-center underline" href="/workspace/new">pilih sendiri</Link>.</p>
        </div>
      )}
      {state.choice === "SPECIAL_CASE" && (
        <div data-testid="saran-kasus-khusus" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
          <p className="text-lg font-bold text-navy">Keperluan Anda mungkin perlu diajukan sebagai Special Legal Case</p>
          <p>Dokumen yang tersedia di Yuktanya belum sesuai untuk keperluan ini. Ajukan sebagai Kasus Hukum Khusus (Special Legal Case) agar firma hukum mitra menilainya lebih dulu. {specialCaseNote}</p>
          <Link href="/cases/new" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-5 font-semibold text-navy hover:bg-subtle">Ajukan Special Legal Case</Link>
        </div>
      )}
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="key" value={state.key} />
        <label className="block">
          <span className="font-semibold text-navy">Pesan Anda</span>
          <textarea key={state.key} name="message" rows={4} required maxLength={2000} defaultValue={state.draft}
            placeholder="Contoh: Saya mau meminjamkan uang Rp5.000.000 ke tetangga."
            className="mt-2 block w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-lg" />
        </label>
        <SendButton />
        <SlowProgress />
      </form>
    </section>
  );
}
