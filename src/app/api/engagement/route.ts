import { prisma } from "@/lib/db";
import { parseDeltas, recordEngagement } from "@/lib/engagement";

export const runtime = "nodejs";

// Beacon from ReadTracker. Sent as text/plain (a CORS-safelisted type, so
// sendBeacon never refuses it) carrying JSON. Always 204: the page can't do
// anything with an error, so failures only go to the log.
export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = JSON.parse(await req.text());
  } catch {
    /* malformed → nothing to record */
  }
  try {
    await recordEngagement(parseDeltas(body));
  } catch (err) {
    console.error("[engagement] record failed:", err instanceof Error ? err.message : err);
  }
  return new Response(null, { status: 204 });
}

// Read-only check that the tracker is reaching the server (counts only).
export async function GET() {
  const [articles, videos, latest] = await Promise.all([
    prisma.engagement.count({ where: { kind: "article" } }),
    prisma.engagement.count({ where: { kind: "video" } }),
    prisma.engagement.findFirst({ orderBy: { lastAt: "desc" }, select: { lastAt: true } }),
  ]);
  return Response.json({ articles, videos, lastAt: latest?.lastAt ?? null });
}
