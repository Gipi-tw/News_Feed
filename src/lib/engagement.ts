import { prisma } from "./db";
import type { DigestConfig } from "./types";
import type { VideoSummary } from "../videos/summarize";

// 閱讀紀錄 → 選文回饋. The digest page (ReadTracker) records, per card, how
// often it crossed the reading line, how long it sat there, and whether its
// links were opened or its text copied. Gipi never rates anything by hand —
// the 6/14 👍👎 export proved any manual step kills the loop. Scoring and
// selection get the recent "read / opened" and "scrolled past" titles as
// examples, and nudge scores toward them.

export interface EngagementDelta {
  kind: "article" | "video";
  targetId: string;
  seen: number;
  ms: number;
  clicks: number;
  copies: number;
}

// Time at the reading line grows with the card: a 900-字 video summary takes
// longer to get through than a 150-字 article card without being any more
// interesting (Gipi, 11/1). So cards are judged by reading speed — 字 per
// second at the line — not by seconds. Gipi skims at a median ~67 字/秒.
export const READ_CPS = 40; // ≤ this = actually read it
const CLOSE_CPS = 20; // ≤ this = 細讀
export const SKIP_CPS = 200; // ≥ this = passed faster than anyone reads = 滑過
export const MIN_LIKED = 5; // cold start: below this, don't touch scoring at all
export const WINDOW_DAYS = 21;
const MAX_EXAMPLES = 30;

const clamp = (v: unknown, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0;

/** The tracker's beacon payload → deltas. Malformed entries are dropped, not errors. */
export function parseDeltas(body: unknown): EngagementDelta[] {
  const list = (body as { e?: unknown } | null)?.e;
  if (!Array.isArray(list)) return [];
  const out: EngagementDelta[] = [];
  for (const raw of list.slice(0, 300)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const m = typeof r.id === "string" ? /^([av]):([\w-]{1,64})$/.exec(r.id) : null;
    if (!m) continue;
    const d: EngagementDelta = {
      kind: m[1] === "a" ? "article" : "video",
      targetId: m[2],
      seen: clamp(r.s, 1), // once per page view
      ms: clamp(r.ms, 600_000),
      clicks: clamp(r.c, 20),
      copies: clamp(r.p, 20),
    };
    if (d.seen || d.ms || d.clicks || d.copies) out.push(d);
  }
  return out;
}

export async function recordEngagement(deltas: EngagementDelta[]): Promise<void> {
  if (!deltas.length) return;
  await prisma.$transaction(
    deltas.map((d) =>
      prisma.engagement.upsert({
        where: { targetId: d.targetId },
        create: { targetId: d.targetId, kind: d.kind, seenCount: d.seen, dwellMs: d.ms, clicks: d.clicks, copies: d.copies },
        update: {
          seenCount: { increment: d.seen },
          dwellMs: { increment: d.ms },
          clicks: { increment: d.clicks },
          copies: { increment: d.copies },
        },
      }),
    ),
  );
}

/** 字 on an article card: title + 事實 + Hook. */
export const articleChars = (a: { title: string; factSummary: string; opinionHook: string }) =>
  (a.title + a.factSummary + a.opinionHook).length;

/** 字 on a 🎬 card: title + every line of the summary. */
export function videoChars(title: string, s: VideoSummary | null): number {
  if (!s) return title.length;
  const lines = [s.verdictReason, s.oneLiner, s.hook, ...s.keyPoints.map((k) => k.point), ...s.quotes.map((q) => q.text), ...s.segments.map((g) => g.why)];
  return title.length + lines.join("").length;
}

/** 字/秒 at the reading line; Infinity when the card never sat there. */
export const charsPerSec = (chars: number, dwellMs: number) => (dwellMs > 0 ? chars / (dwellMs / 1000) : Infinity);

export interface SignalRow {
  title: string;
  chars: number;
  tier: string;
  tierLabel: string;
  sourceName: string;
  digestId: string;
  seenCount: number;
  dwellMs: number;
  clicks: number;
  copies: number;
  lastAt: Date;
}

export interface SignalExample {
  title: string;
  tierLabel: string;
  sourceName: string;
  how: string; // 點開原文、細讀…
}

export interface ReadingSignals {
  seen: number; // articles that crossed the reading line at least once
  likedTotal: number;
  skippedTotal: number;
  liked: SignalExample[];
  skipped: SignalExample[];
}

const isRead = (r: { chars: number; dwellMs: number }) => charsPerSec(r.chars, r.dwellMs) <= READ_CPS;
const isLiked = (r: SignalRow) => r.clicks > 0 || r.copies > 0 || isRead(r);

function how(r: SignalRow): string {
  const parts: string[] = [];
  if (r.clicks) parts.push("點開原文");
  if (r.copies) parts.push("複製文字");
  const cps = charsPerSec(r.chars, r.dwellMs);
  if (cps <= CLOSE_CPS) parts.push("細讀");
  else if (cps <= READ_CPS) parts.push("讀過");
  return parts.join("、") || (cps >= SKIP_CPS ? "直接滑過" : "瞄過");
}

const example = (r: SignalRow): SignalExample => ({
  title: r.title,
  tierLabel: r.tierLabel,
  sourceName: r.sourceName,
  how: how(r),
});

export function classifySignals(rows: SignalRow[]): ReadingSignals {
  const liked = rows
    .filter(isLiked)
    .sort((a, b) => strength(b) - strength(a) || b.lastAt.getTime() - a.lastAt.getTime());
  // A fast pass only counts as a skip in a tier Gipi was reading that day:
  // flinging past a whole tier to get to 🎬 says nothing about its articles.
  const readTiers = new Set(liked.map((r) => `${r.digestId}|${r.tier}`));
  const skipped = rows
    .filter((r) => r.seenCount > 0 && !isLiked(r) && charsPerSec(r.chars, r.dwellMs) >= SKIP_CPS && readTiers.has(`${r.digestId}|${r.tier}`))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return {
    seen: rows.filter((r) => r.seenCount > 0).length,
    likedTotal: liked.length,
    skippedTotal: skipped.length,
    liked: liked.slice(0, MAX_EXAMPLES).map(example),
    skipped: skipped.slice(0, MAX_EXAMPLES).map(example),
  };
}

// An opened link or a copy outranks any reading; reading ranks by ms per 字.
const strength = (r: SignalRow) => (r.clicks + r.copies) * 1e6 + r.dwellMs / Math.max(r.chars, 1);

/**
 * The system-prompt section for scoring and selection; "" until there's
 * enough to go on, so a cold start changes nothing.
 */
export function readingSignalsPrompt(s: ReadingSignals): string {
  if (s.likedTotal < MIN_LIKED) return "";
  const line = (e: SignalExample) => `- [${e.tierLabel}] ${e.title}｜${e.sourceName}（${e.how}）`;
  return `

# 近期閱讀行為（系統自動記錄，不是 Gipi 手寫；最近 ${WINDOW_DAYS} 天）
用來校準判斷：跟「讀了或點開」主題、角度相近的，可加 1–2 分或優先挑；跟「直接滑過」相近的，可減 1–2 分或往後排。
這只是微調：不能推翻區塊定位、全域排除規則與興趣輪廓；單一則不代表整個主題，看共同模式。

## 讀了或點開（${s.likedTotal} 篇，列前 ${s.liked.length}）
${s.liked.map(line).join("\n")}${
    s.skipped.length
      ? `

## 直接滑過（${s.skippedTotal} 篇，列最近 ${s.skipped.length}）
${s.skipped.map(line).join("\n")}`
      : ""
  }`;
}

/** For run logs: how much reading history the model was given. */
export function signalStats(s: ReadingSignals) {
  return { seen: s.seen, liked: s.likedTotal, skipped: s.skippedTotal, used: readingSignalsPrompt(s) !== "" };
}

export async function loadReadingSignals(cfg: DigestConfig, now = new Date()): Promise<ReadingSignals> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const eng = await prisma.engagement.findMany({ where: { kind: "article", lastAt: { gte: since } } });
  const articles = eng.length
    ? await prisma.article.findMany({
        where: { id: { in: eng.map((e) => e.targetId) } },
        select: { id: true, title: true, tier: true, sourceName: true, digestId: true, factSummary: true, opinionHook: true },
      })
    : [];
  const byId = new Map(articles.map((a) => [a.id, a]));
  const labels = new Map<string, string>(cfg.tiers.map((t) => [t.key, `${t.emoji} ${t.label.split("：")[0]}`]));
  const rows: SignalRow[] = [];
  for (const e of eng) {
    const a = byId.get(e.targetId);
    if (!a) continue; // its digest was deleted
    rows.push({
      ...e,
      title: a.title,
      chars: articleChars(a),
      tier: a.tier,
      tierLabel: labels.get(a.tier) ?? a.tier,
      sourceName: a.sourceName,
      digestId: a.digestId,
    });
  }
  return classifySignals(rows);
}

export interface VideoSignals {
  seen: number; // summaries that crossed the reading line
  read: number; // summaries actually read (by 字/秒, not seconds)
  opened: number; // opened the video or a timestamp
}

/** 🎬 cards, same reading-speed rule. Not fed to video selection yet — shown on /settings. */
export function classifyVideos(rows: { chars: number; dwellMs: number; seenCount: number; clicks: number }[]): VideoSignals {
  return {
    seen: rows.filter((r) => r.seenCount > 0).length,
    read: rows.filter(isRead).length,
    opened: rows.filter((r) => r.clicks > 0).length,
  };
}

export async function loadVideoSignals(now = new Date()): Promise<VideoSignals> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const eng = await prisma.engagement.findMany({ where: { kind: "video", lastAt: { gte: since } } });
  const videos = eng.length
    ? await prisma.video.findMany({ where: { id: { in: eng.map((e) => e.targetId) } }, select: { id: true, title: true, summary: true } })
    : [];
  const chars = new Map(
    videos.map((v) => {
      let s: VideoSummary | null = null;
      try { s = v.summary ? (JSON.parse(v.summary) as VideoSummary) : null; } catch { s = null; }
      return [v.id, videoChars(v.title, s)];
    }),
  );
  return classifyVideos(eng.filter((e) => chars.has(e.targetId)).map((e) => ({ ...e, chars: chars.get(e.targetId)! })));
}
