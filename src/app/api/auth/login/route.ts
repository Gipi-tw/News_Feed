import { NextResponse } from "next/server";
import { createSession, verifyCredentials } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!(await verifyCredentials(username, password))) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  await createSession(username);
  return NextResponse.json({ ok: true });
}
