"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EditorPanelId = "dokumen" | "catatan" | "pemeriksaan" | "hasil";
export type EditorPanel = { id: EditorPanelId; label: string; content: ReactNode };

// HP/tablet: tab Dokumen | Catatan | Pemeriksaan | Hasil (satu bagian tampil). Layar lebar: dokumen di kiri, panel kerja di kanan.
export function EditorTabs({ panels, initial }: { panels: EditorPanel[]; initial: EditorPanelId }) {
  const [active, setActive] = useState<EditorPanelId>(initial);
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Bagian pemeriksaan" className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-white p-2 sm:grid-cols-4 xl:hidden">
        {panels.map((p) => (
          <button key={p.id} type="button" role="tab" id={`tab-${p.id}`} aria-selected={active === p.id} aria-controls={`panel-${p.id}`}
            onClick={() => setActive(p.id)}
            className={cn("min-h-12 rounded-xl px-2 text-base font-semibold", active === p.id ? "bg-brand text-white" : "bg-slate-100 text-ink hover:bg-slate-200")}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-8">
        {panels.map((p) => (
          <section key={p.id} id={`panel-${p.id}`} role="tabpanel" aria-labelledby={`tab-${p.id}`} data-panel={p.id}
            className={cn("min-w-0 space-y-4", active === p.id ? "block" : "hidden xl:block",
              p.id === "dokumen" ? "xl:sticky xl:top-6 xl:row-span-3 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto" : "xl:col-start-2 xl:mb-8")}>
            {p.content}
          </section>
        ))}
      </div>
    </div>
  );
}
