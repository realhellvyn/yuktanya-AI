"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

// Task 24 (A04): balasan AI bisa memakan waktu lama (p95 28 detik). Setelah 10 detik menunggu, teks tenang ditampilkan dan
// dibacakan pembaca layar (wilayah aria-live polite yang selalu ada, isinya baru diisi saat lambat). Tanpa spinner berkedip.
export const SLOW_AFTER_MS = 10_000;
export const SLOW_TEXT = "AI masih menyusun jawaban. Ini bisa memakan waktu hingga satu menit.";

// Pewaktu murni: onSlow dipanggil setelah ms kecuali dibatalkan lebih dulu. Mengembalikan fungsi pembatal.
export function startSlowTimer(ms: number, onSlow: () => void): () => void {
  const t = setTimeout(onSlow, ms);
  return () => clearTimeout(t);
}

export function SlowProgressText({ show }: { show: boolean }) {
  return (
    <p role="status" aria-live="polite" data-testid="ai-lambat" className="text-muted">
      {show ? SLOW_TEXT : ""}
    </p>
  );
}

// Dipasang di dalam <form> yang mengirim pesan ke AI; membaca status kirim formulir itu.
export function SlowProgress() {
  const { pending } = useFormStatus();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const cancel = startSlowTimer(SLOW_AFTER_MS, () => setSlow(true));
    return () => {
      cancel();
      setSlow(false);
    };
  }, [pending]);
  return <SlowProgressText show={pending && slow} />;
}
