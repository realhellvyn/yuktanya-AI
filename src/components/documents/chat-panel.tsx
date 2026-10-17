"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { claimDrafts, clearDraft, loadDraft, reconcileDraft, safeLocalStorage, saveDraft } from "@/lib/documents/chat-draft";

export type ChatLine = { id: string; role: "user" | "assistant"; content: string };

function SendButton({ offline }: { offline: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || offline} aria-describedby={offline ? "chat-offline" : undefined} className="min-h-[52px] rounded-xl bg-primary px-6 text-lg font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
      {pending ? "AI sedang berpikir…" : "Kirim"}
    </button>
  );
}

function RetryButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="min-h-12 rounded-xl border border-border-strong bg-surface px-5 font-semibold hover:bg-subtle disabled:opacity-60">
      {pending ? "Mencoba…" : "Coba lagi"}
    </button>
  );
}

export function OfflineNotice({ offline }: { offline: boolean }) {
  if (!offline) return null;
  return (
    <p id="chat-offline" role="status" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold">
      Anda sedang offline. Pesan belum bisa dikirim.
      <span className="mt-1 block font-normal">Tombol Kirim aktif lagi saat internet tersambung. Tulisan Anda tetap tersimpan di perangkat ini.</span>
    </p>
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
  // Akun yang sedang masuk: draf di perangkat ini hanya dipakai untuk akun yang sama.
  userId: string;
};

// Percakapan: transkrip + kotak pesan. Pesan pengguna yang belum terjawab tampil dengan tombol Coba lagi.
export function ChatPanel({ documentId, lines, greeting, action, sendKey, retryKey, hasUnanswered, placeholder, userId }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [offline, setOffline] = useState(false);
  const [restored, setRestored] = useState(false);
  // Badan blok: Chrome 149/150+ mengembalikan Promise dari scrollIntoView; bila dikembalikan, React memanggilnya sebagai
  // cleanup pada balasan berikutnya ("i is not a function", Task 17).
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);
  const lastUser = [...lines].reverse().find((l) => l.role === "user")?.content;

  // Setiap render server baru (sendKey berganti): draf yang sudah tersimpan sebagai pesan dibuang; draf yang belum
  // terkirim (gagal, dialihkan ke login, muat ulang) dikembalikan ke kotak pesan.
  useEffect(() => {
    const storage = safeLocalStorage();
    claimDrafts(storage, userId);
    const draft = loadDraft(storage, documentId);
    const verdict = reconcileDraft(draft, lastUser);
    if (verdict === "clear") {
      clearDraft(storage, documentId);
      if (box.current && box.current.value.trim() === draft?.trim()) box.current.value = "";
    } else if (verdict === "restore" && box.current && !box.current.value) {
      box.current.value = draft!;
      setRestored(true);
    }
  }, [documentId, sendKey, lastUser, userId]);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Formulir dapat dikosongkan otomatis setelah aksi; bila draf masih ada (belum terbukti terkirim), kembalikan.
  const onReset = () => {
    setTimeout(() => {
      const draft = loadDraft(safeLocalStorage(), documentId);
      if (draft && box.current && !box.current.value) box.current.value = draft;
    }, 0);
  };
  return (
    <section aria-label="Percakapan dengan AI" className="space-y-4">
      <ol className="space-y-3" aria-live="polite" aria-relevant="additions">
        <li className="max-w-[92%] rounded-2xl rounded-tl-sm border border-line bg-surface p-4"><span className="sr-only">AI: </span>{greeting}</li>
        {lines.map((m) => (
          <li key={m.id} className={m.role === "user" ? "ml-auto max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-tint p-4 ring-1 ring-line" : "max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-line bg-surface p-4"}>
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
      <form action={action} onReset={onReset} className="space-y-3">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="key" value={sendKey} />
        <OfflineNotice offline={offline} />
        <label className="block">
          <span className="font-semibold text-navy">Pesan Anda</span>
          <textarea
            ref={box}
            name="message"
            rows={4}
            required
            maxLength={2000}
            placeholder={placeholder}
            onInput={(e) => {
              saveDraft(safeLocalStorage(), documentId, e.currentTarget.value);
              setRestored(false);
            }}
            className="mt-2 block w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-lg"
          />
        </label>
        {restored && <p role="status" className="text-muted">Tulisan Anda yang belum terkirim sudah dikembalikan.</p>}
        <SendButton offline={offline} />
      </form>
    </section>
  );
}
