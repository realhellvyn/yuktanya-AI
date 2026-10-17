"use client";

import { useEffect } from "react";
import { clearAllDrafts, safeLocalStorage } from "@/lib/documents/chat-draft";

// Membuang draf pesan yang mungkin tertinggal di perangkat ini setelah akun dihapus.
export function ClearLocalDrafts() {
  useEffect(() => {
    clearAllDrafts(safeLocalStorage());
  }, []);
  return null;
}
