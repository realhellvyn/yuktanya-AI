"use client";

import { useState } from "react";

export function PasswordField({ autoComplete }: { autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="font-semibold">Kata sandi <span className="font-normal text-muted">(Wajib, minimal 8 karakter)</span></span>
      <span className="mt-2 flex items-stretch gap-2">
        <input name="password" type={show ? "text" : "password"} required minLength={8} autoComplete={autoComplete} className="block min-h-12 w-full rounded-xl border border-border-strong bg-surface px-4 text-lg" />
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} className="min-h-12 shrink-0 rounded-xl border border-border-strong bg-surface px-4 font-semibold hover:bg-subtle">
          {show ? "Sembunyikan" : "Tampilkan"}
        </button>
      </span>
    </label>
  );
}
