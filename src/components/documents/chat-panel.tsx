"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type ChatLine = { id: string; role: "user" | "assistant"; content: string };

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="min-h-[52px] rounded-xl bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
      {pending ? "AI sedang berpikir…" : "Kirim"}
    </button>
  );
}

function RetryButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="min-h-12 rounded-xl border border-slate-400 bg-white px-5 font-semibold hover:bg-slate-50 disabled:opacity-60">
      {pending ? "Mencoba…" : "Coba lagi"}
    </button>
  );
}

type Props = {
  documentId: string;
  lines: ChatLine[];
  greeting: string;
  action: (formData: FormData) => Promise<void>;
  sendKey: string;
  retryKey: string;
  hasUnanswered: boolean;
  placeholder: string;
};

// Percakapan: transkrip + kotak pesan. Pesan pengguna yang belum terjawab tampil dengan tombol Coba lagi.
export function ChatPanel({ documentId, lines, greeting, action, sendKey, retryKey, hasUnanswered, placeholder }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines.length]);
  return (
    <section aria-label="Percakapan dengan AI" className="space-y-4">
      <ol className="space-y-3" aria-live="polite" aria-relevant="additions">
        <li className="max-w-[92%] rounded-2xl rounded-tl-sm border border-line bg-white p-4"><span className="sr-only">AI: </span>{greeting}</li>
        {lines.map((m) => (
          <li key={m.id} className={m.role === "user" ? "ml-auto max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-blue-50 p-4 ring-1 ring-blue-200" : "max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-line bg-white p-4"}>
            <span className="sr-only">{m.role === "user" ? "Anda: " : "AI: "}</span>{m.content}
          </li>
        ))}
      </ol>
      <div ref={end} />
      {hasUnanswered && (
        <form action={action} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400 bg-amber-50 p-3">
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="retry" value="1" />
          <input type="hidden" name="key" value={retryKey} />
          <p className="flex-1">Pesan terakhir Anda belum dijawab AI.</p>
          <RetryButton />
        </form>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="key" value={sendKey} />
        <label className="block">
          <span className="font-semibold text-navy">Pesan Anda</span>
          <textarea name="message" rows={4} required maxLength={2000} placeholder={placeholder} className="mt-2 block w-full rounded-xl border border-slate-400 bg-white px-4 py-3 text-lg" />
        </label>
        <SendButton />
      </form>
    </section>
  );
}
