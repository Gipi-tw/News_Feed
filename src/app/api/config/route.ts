import { NextResponse } from "next/server";
import { setSetting } from "@/lib/config";

export const runtime = "nodejs";

const KEYS = ["interest_profile", "style_guide", "digest_config"] as const;

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Validate digest_config is parseable JSON before persisting.
  if (typeof body.digest_config === "string") {
    try {
      JSON.parse(body.digest_config);
    } catch {
      return NextResponse.json({ error: "digest_config is not valid JSON" }, { status: 400 });
    }
  }
  for (const key of KEYS) {
    if (typeof body[key] === "string") {
      await setSetting(key, body[key]);
    }
  }
  return NextResponse.json({ ok: true });
}
