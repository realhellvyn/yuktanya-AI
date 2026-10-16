"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ackLimiter, shareService } from "@/lib/vault/runtime";
import { InvalidEmailError } from "@/lib/vault/share";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
async function ip(): Promise<string> {
  return ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

export async function requestAckAction(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const email = str(formData, "email");
  const back = (q: string): never => redirect(`/s/${encodeURIComponent(token)}?${q}`);
  if (!ackLimiter.allow(await ip())) back("error=busy");
  try {
    const r = await shareService().requestAck(token, email);
    if (r === "RATE_LIMITED") back("error=rate");
    // Respons sama untuk email apa pun bila tautan valid; tautan tidak valid tampil sebagai halaman tidak ditemukan.
    back(`step=kode&e=${encodeURIComponent(email.trim().toLowerCase())}`);
  } catch (e) {
    if (e instanceof InvalidEmailError) back("error=email");
    throw e;
  }
}

export async function verifyAckAction(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const email = str(formData, "email");
  const back = (q: string): never => redirect(`/s/${encodeURIComponent(token)}?${q}`);
  if (!ackLimiter.allow(await ip())) back(`step=kode&e=${encodeURIComponent(email)}&error=busy`);
  try {
    const r = await shareService().verifyAck(token, email, str(formData, "code"));
    back(r === "VERIFIED" ? "result=VERIFIED" : `step=kode&e=${encodeURIComponent(email)}&result=${r}`);
  } catch (e) {
    if (e instanceof InvalidEmailError) back("error=email");
    throw e;
  }
}
