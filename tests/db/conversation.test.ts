import { afterAll, describe, expect, it } from "vitest";
import { findTurnByKey, listMessages, saveAssistantReply, saveUserMessage } from "@/lib/documents/conversation";
import { createPgDocumentsService } from "@/lib/documents/service";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const newDoc = async (u: string) => (await docs.create(u, "NDA", key())).documentId;

describe("percakapan dokumen", () => {
  it("urutan pesan stabil; balasan menandai pesan pengguna terjawab", async () => {
    const u = await createUser(pool);
    const id = await newDoc(u);
    const k = key();
    const m1 = await saveUserMessage(pool, u, id, "Halo, saya mau NDA", k);
    expect(m1.duplicate).toBe(false);
    expect((await listMessages(pool, u, id)).map((m) => [m.role, m.answered])).toEqual([["user", false]]);
    await saveAssistantReply(pool, u, id, "Siapa pihak pertama?");
    const all = await listMessages(pool, u, id);
    expect(all.map((m) => [m.role, m.content, m.answered])).toEqual([["user", "Halo, saya mau NDA", true], ["assistant", "Siapa pihak pertama?", true]]);
  });

  it("kunci idempoten sama tidak membuat pesan kedua dan dapat dicari", async () => {
    const u = await createUser(pool);
    const id = await newDoc(u);
    const k = key();
    await saveUserMessage(pool, u, id, "satu", k);
    const again = await saveUserMessage(pool, u, id, "satu", k);
    expect(again.duplicate).toBe(true);
    expect(await listMessages(pool, u, id)).toHaveLength(1);
    expect((await findTurnByKey(pool, u, id, k))?.reply).toBeNull();
    await saveAssistantReply(pool, u, id, "jawab");
    expect((await findTurnByKey(pool, u, id, k))?.reply).toBe("jawab");
  });

  it("pengguna lain tidak dapat membaca atau menulis percakapan", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const id = await newDoc(a);
    await expect(saveUserMessage(pool, b, id, "intip", key())).rejects.toThrow(/NOT_FOUND/);
    expect(await listMessages(pool, b, id)).toEqual([]);
  });

  it("isi pesan dibatasi 4000 karakter", async () => {
    const u = await createUser(pool);
    const id = await newDoc(u);
    await expect(saveUserMessage(pool, u, id, "x".repeat(4001), key())).rejects.toThrow();
  });
});
