import { env } from "../lib/env";

// Supadata transcripts (YouTube blocks caption fetches from datacenter IPs).
// Verified 2026-10-10 from a cloud IP: mode=native returns existing captions,
// including YouTube's auto-generated ones, for 1 point per video regardless of
// length. Always pass mode=native (the default "auto" falls back to AI
// transcription at 2 points/minute) and lang=en (otherwise a dubbed audio
// track's language can come back — a YC video returned Arabic).

const BASE = "https://api.supadata.ai/v1";

export type TranscriptResult =
  | { status: "ok"; lines: [number, string][]; lang: string }
  | { status: "unavailable" } // 206: no captions (still costs 1 point)
  | { status: "limit"; error: string } // out of points / rate-limited
  | { status: "error"; error: string };

async function call(path: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": env.supadataKey },
    signal: AbortSignal.timeout(120_000),
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

export function supadataAvailable(): boolean {
  return Boolean(env.supadataKey);
}

/** Points used / available in the current billing period (free call). */
export async function supadataCredits(): Promise<{ used: number; max: number; plan: string } | null> {
  const r = await call("/me");
  if (r.status !== 200 || !r.json) return null;
  return {
    used: Number(r.json.usedCredits ?? 0),
    max: Number(r.json.maxCredits ?? 0),
    plan: String(r.json.plan ?? ""),
  };
}

type Chunk = { text: string; offset: number; duration?: number };

/** Merge caption chunks into ~30-second lines: [startSec, text]. */
export function compactTranscript(chunks: Chunk[], windowSec = 30): [number, string][] {
  const out: [number, string][] = [];
  for (const c of chunks) {
    const t = Math.floor((c.offset ?? 0) / 1000);
    const text = String(c.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && t - last[0] < windowSec) last[1] += " " + text;
    else out.push([t, text]);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchTranscript(videoId: string, lang: string): Promise<TranscriptResult> {
  const url = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
  let r = await call(`/transcript?url=${url}&mode=native&lang=${encodeURIComponent(lang)}`);
  if (r.status === 206) return { status: "unavailable" };
  if (r.status === 402 || r.status === 429) return { status: "limit", error: String(r.json?.message ?? r.status) };
  if (r.status >= 400 || !r.json) return { status: "error", error: `HTTP ${r.status} ${String(r.json?.message ?? "")}`.trim() };

  // Long videos come back as a job (polling is free; results expire after 1h).
  if (typeof r.json.jobId === "string") {
    const jobId = r.json.jobId;
    for (let i = 0; i < 60; i++) {
      await sleep(5_000);
      r = await call(`/transcript/${jobId}`);
      const status = r.json?.status;
      if (status === "completed") break;
      if (status === "failed") {
        const err = r.json?.error as { error?: string; message?: string } | null;
        return err?.error === "transcript-unavailable"
          ? { status: "unavailable" }
          : { status: "error", error: err?.message ?? "job failed" };
      }
    }
    if (r.json?.status !== "completed") return { status: "error", error: "job timed out" };
  }

  const content = r.json?.content;
  if (!Array.isArray(content) || !content.length) return { status: "unavailable" };
  return { status: "ok", lines: compactTranscript(content as Chunk[]), lang: String(r.json?.lang ?? lang) };
}
