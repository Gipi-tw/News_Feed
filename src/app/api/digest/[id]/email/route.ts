import { NextResponse } from "next/server";
import { sendDigestEmail } from "@/pipeline/notify";

// Re-send one digest by email (e.g. to check the email setup without running
// a new digest). Auth-gated by middleware.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = await sendDigestEmail(id);
  return NextResponse.json({ status }, { status: status.startsWith("sent") ? 200 : 502 });
}
