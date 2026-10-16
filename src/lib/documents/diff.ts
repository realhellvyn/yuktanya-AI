import type { RenderedDoc } from "./render";

export type BlockChange = { id: string; change: "added" | "removed" | "changed" | "same"; before?: string; after?: string };

// Fungsi murni berbasis Block.id: urutan mengikuti dokumen baru (b), lalu blok yang hanya ada di dokumen lama (a).
export function diffRendered(a: RenderedDoc, b: RenderedDoc): BlockChange[] {
  const before = new Map(a.blocks.map((x) => [x.id, x.text]));
  const afterIds = new Set(b.blocks.map((x) => x.id));
  const out: BlockChange[] = b.blocks.map((blk) => {
    const prev = before.get(blk.id);
    if (prev === undefined) return { id: blk.id, change: "added", after: blk.text };
    if (prev === blk.text) return { id: blk.id, change: "same" };
    return { id: blk.id, change: "changed", before: prev, after: blk.text };
  });
  for (const blk of a.blocks) if (!afterIds.has(blk.id)) out.push({ id: blk.id, change: "removed", before: blk.text });
  return out;
}
