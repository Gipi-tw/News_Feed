import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runDigest } from "@/pipeline";

// Async trigger: POST starts a background run and returns immediately; the UI
// polls GET for live status. (Already auth-gated by middleware.)
export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST() {
  // Guard: don't start a second run while one is already in progress.
  const running = await prisma.runLog.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" },
  });
  if (running && Date.now() - running.startedAt.getTime() < 30 * 60_000) {
    return NextResponse.json({ status: "running", runId: running.id }, { status: 202 });
  }

  const run = await prisma.runLog.create({
    data: { trigger: "manual", status: "running", message: "排隊中…" },
  });
  // Fire-and-forget — runDigest owns the RunLog lifecycle. The machine is kept
  // always-on (fly.toml auto_stop=off) so background work isn't suspended.
  runDigest({ trigger: "manual", runId: run.id }).catch((e) =>
    console.error("[digest/run] background error:", e),
  );
  return NextResponse.json({ status: "started", runId: run.id }, { status: 202 });
}

export async function GET() {
  const run = await prisma.runLog.findFirst({ orderBy: { startedAt: "desc" } });
  if (!run) return NextResponse.json({ status: "idle" });
  return NextResponse.json({
    status: run.status,
    message: run.message,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    digestId: run.digestId,
  });
}
