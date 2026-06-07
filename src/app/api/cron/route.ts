import { NextResponse } from "next/server";
import { runDigest } from "@/pipeline";
import { env } from "@/lib/env";

// Cron entrypoint. This path is excluded from session auth in middleware, so it
// guards itself with a shared bearer secret. The scheduler hits it at 08:00
// Asia/Taipei (see fly.toml / README).
export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  if (!env.cronSecret) return false; // refuse if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${env.cronSecret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDigest({ trigger: "cron" });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle; // some schedulers only do GET
