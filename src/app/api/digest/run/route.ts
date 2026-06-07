import { NextResponse } from "next/server";
import { runDigest } from "@/pipeline";

// Manual trigger (already auth-gated by middleware). Long-running.
export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runDigest({ trigger: "manual" });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
