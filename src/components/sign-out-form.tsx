"use client";

import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { clearAllDrafts, safeLocalStorage } from "@/lib/documents/chat-draft";

// Tombol Keluar: draf pesan di perangkat ini dibuang saat formulir dikirim (perangkat bersama), lalu sesi diakhiri di server.
export function SignOutForm({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <form action={signOut} className={className} onSubmit={() => clearAllDrafts(safeLocalStorage())}>
      {children}
    </form>
  );
}
