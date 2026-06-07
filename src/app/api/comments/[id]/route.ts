import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { myComment?: string; commentStatus?: string } = {};

  if (typeof body.myComment === "string") data.myComment = body.myComment;
  if (
    body.commentStatus === "draft" ||
    body.commentStatus === "edited" ||
    body.commentStatus === "published"
  ) {
    data.commentStatus = body.commentStatus;
  }
  // Editing the text without an explicit status implies it's now edited.
  if (data.myComment !== undefined && data.commentStatus === undefined) {
    data.commentStatus = "edited";
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.article.update({ where: { id }, data });
    return NextResponse.json({ ok: true, commentStatus: updated.commentStatus });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
