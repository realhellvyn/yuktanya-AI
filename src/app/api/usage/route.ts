import { NextResponse } from "next/server";
import { createPgUsageStore } from "@/lib/ai/quota";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";

export async function GET() {
  // userId hanya dari sesi; tidak pernah dari klien.
  const session = await getSessionRoles();
  if (!session) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  return NextResponse.json(await createPgUsageStore(getPool()).snapshot(session.userId));
}
