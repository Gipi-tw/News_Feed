import { prisma } from "./db";
import type { DigestConfig } from "./types";

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

export const READ_MS = 8_000; // this long at the reading line = 讀了
export const SKIP_MS = 1_500; // crossed the line but left sooner = 滑過
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

export interface SignalRow {
  title: string;
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
  how: string; // 點開原文、讀 23 秒…
}

export interface ReadingSignals {
  seen: number; // articles that crossed the reading line at least once
  likedTotal: number;
  skippedTotal: number;
  liked: SignalExample[];
  skipped: SignalExample[];
}

const isLiked = (r: SignalRow) => r.clicks > 0 || r.copies > 0 || r.dwellMs >= READ_MS;

function how(r: SignalRow): string {
  const parts: string[] = [];
  if (r.clicks) parts.push("點開原文");
  if (r.copies) parts.push("複製文字");
  if (r.dwellMs >= SKIP_MS) parts.push(`讀 ${Math.round(r.dwellMs / 1000)} 秒`);
  return parts.join("、") || "停不到 2 秒";
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
    .filter((r) => r.seenCount > 0 && !isLiked(r) && r.dwellMs < SKIP_MS && readTiers.has(`${r.digestId}|${r.tier}`))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return {
    seen: rows.filter((r) => r.seenCount > 0).length,
    likedTotal: liked.length,
    skippedTotal: skipped.length,
    liked: liked.slice(0, MAX_EXAMPLES).map(example),
    skipped: skipped.slice(0, MAX_EXAMPLES).map(example),
  };
}

// An opened link or a copy outranks any amount of reading time.
const strength = (r: SignalRow) => (r.clicks + r.copies) * 600_000 + r.dwellMs;

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
        select: { id: true, title: true, tier: true, sourceName: true, digestId: true },
      })
    : [];
  const byId = new Map(articles.map((a) => [a.id, a]));
  const labels = new Map<string, string>(cfg.tiers.map((t) => [t.key, `${t.emoji} ${t.label.split("：")[0]}`]));
  const rows: SignalRow[] = [];
  for (const e of eng) {
    const a = byId.get(e.targetId);
    if (!a) continue; // its digest was deleted
    rows.push({ ...e, ...a, tierLabel: labels.get(a.tier) ?? a.tier });
  }
  return classifySignals(rows);
}
