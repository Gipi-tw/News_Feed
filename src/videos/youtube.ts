// New uploads come from each channel's /videos tab, not its RSS feed: since
// mid-Oct 2026 the channel RSS answers 404/500 at random from the Fly machine,
// while the tab page works and also gives the duration (and never lists Shorts).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export interface ChannelVideo {
  id: string;
  title: string;
  durationSec: number; // 0 = unknown / upcoming / live
  publishedAt: Date | null; // approximate (from "2d ago")
}

/** "1:34:20" / "14:56" → seconds; anything else → 0. */
export function parseDuration(s: string): number {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s.trim())) return 0;
  return s
    .trim()
    .split(":")
    .reduce((acc, part) => acc * 60 + Number(part), 0);
}

const UNIT_MS: Record<string, number> = {
  s: 1_000, sec: 1_000, second: 1_000,
  m: 60_000, min: 60_000, minute: 60_000,
  h: 3_600_000, hr: 3_600_000, hour: 3_600_000,
  d: 86_400_000, day: 86_400_000,
  w: 604_800_000, wk: 604_800_000, week: 604_800_000,
  mo: 2_592_000_000, month: 2_592_000_000,
  y: 31_536_000_000, yr: 31_536_000_000, year: 31_536_000_000,
};

/** "14h ago" / "2 days ago" / "Streamed 3w ago" → approximate Date. */
export function parseRelativeTime(s: string, now = Date.now()): Date | null {
  const m = s.match(/(\d+)\s*(mo|months?|y|yrs?|years?|w|wks?|weeks?|d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\s+ago/i);
  if (!m) return null;
  const raw = m[2].toLowerCase();
  const unit = raw === "s" ? "s" : raw.replace(/s$/, "");
  const ms = UNIT_MS[unit];
  return ms ? new Date(now - Number(m[1]) * ms) : null;
}

function initialData(html: string): unknown {
  const marker = "var ytInitialData = ";
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length;
  const end = html.indexOf(";</script>", start);
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

function* walk(o: unknown): Generator<Record<string, unknown>> {
  if (o && typeof o === "object") {
    yield o as Record<string, unknown>;
    for (const v of Object.values(o)) yield* walk(v);
  }
}

/** Videos listed in a channel /videos tab page (both renderer generations). */
export function parseVideosTab(html: string, now = Date.now()): ChannelVideo[] {
  const data = initialData(html);
  if (!data) return [];
  const out = new Map<string, ChannelVideo>();
  for (const n of walk(data)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = n.videoRenderer as any;
    if (v?.videoId && !out.has(v.videoId)) {
      out.set(v.videoId, {
        id: v.videoId,
        title: v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? "",
        durationSec: parseDuration(v.lengthText?.simpleText ?? ""),
        publishedAt: parseRelativeTime(v.publishedTimeText?.simpleText ?? "", now),
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = n.lockupViewModel as any;
    if (l?.contentId && l.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && !out.has(l.contentId)) {
      const meta = JSON.stringify(l.metadata ?? {});
      out.set(l.contentId, {
        id: l.contentId,
        title: l.metadata?.lockupMetadataViewModel?.title?.content ?? "",
        durationSec: parseDuration(JSON.stringify(l.contentImage ?? {}).match(/"text":"(\d+(?::\d+){1,2})"/)?.[1] ?? ""),
        publishedAt: parseRelativeTime(meta.match(/"content":"([^"]*ago)"/)?.[1] ?? "", now),
      });
    }
  }
  return [...out.values()];
}

export async function listChannelVideos(handle: string): Promise<ChannelVideo[]> {
  const res = await fetch(`https://www.youtube.com/@${handle}/videos`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseVideosTab(await res.text());
}

export const watchUrl = (id: string, atSec?: number) =>
  `https://www.youtube.com/watch?v=${id}${atSec ? `&t=${Math.floor(atSec)}s` : ""}`;
