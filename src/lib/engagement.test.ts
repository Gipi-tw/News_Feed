import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_LIKED,
  READ_CPS,
  SKIP_CPS,
  charsPerSec,
  classifySignals,
  classifyVideos,
  parseDeltas,
  readingSignalsPrompt,
  videoChars,
  type SignalRow,
} from "./engagement";

test("beacon payload: well-formed entries kept and clamped, the rest dropped", () => {
  const d = parseDeltas({
    e: [
      { id: "a:cm2abc123", s: 1, ms: 12_345.6, c: 0, p: 0 },
      { id: "v:dQw4w9WgXcQ", s: 3, ms: 9e9, c: 1, p: 0 }, // seen once per view; dwell capped
      { id: "x:nope", s: 1 },
      { id: "a:../../etc", s: 1 },
      { id: "a:empty", s: 0, ms: 0, c: 0, p: 0 }, // nothing to add
      { id: "a:neg", s: -1, ms: -5, c: "3", p: null },
      null,
    ],
  });
  assert.deepEqual(d, [
    { kind: "article", targetId: "cm2abc123", seen: 1, ms: 12_346, clicks: 0, copies: 0 },
    { kind: "video", targetId: "dQw4w9WgXcQ", seen: 1, ms: 600_000, clicks: 1, copies: 0 },
  ]);
  assert.deepEqual(parseDeltas(null), []);
  assert.deepEqual(parseDeltas({ e: "x" }), []);
});

const row = (title: string, o: Partial<SignalRow> = {}): SignalRow => ({
  title,
  chars: 300,
  tier: "food",
  tierLabel: "🍔 餐飲・飲料產業",
  sourceName: "NRN",
  digestId: "d1",
  seenCount: 1,
  dwellMs: 0,
  clicks: 0,
  copies: 0,
  lastAt: new Date("2026-11-01T01:00:00Z"),
  ...o,
});

test("liked = opened, copied, or read slowly enough; opening outranks reading", () => {
  const s = classifySignals([
    row("close read", { dwellMs: 60_000 }), // 5 字/秒
    row("read", { dwellMs: 9_000 }), // 33 字/秒
    row("opened", { clicks: 1, dwellMs: 3_000 }),
    row("glanced", { dwellMs: 4_000 }), // 75 字/秒: neither liked nor skipped
    row("copied", { copies: 1 }),
  ]);
  assert.deepEqual(s.liked.map((e) => e.title), ["opened", "copied", "close read", "read"]);
  assert.deepEqual(s.liked.map((e) => e.how), ["點開原文", "複製文字", "細讀", "讀過"]);
  assert.equal(s.seen, 5);
});

test("reading speed, not seconds: a long card needs proportionally longer", () => {
  // 11/1: 16s on a 716-字 video summary is skimming; 16s on a 300-字 card is reading.
  const s = classifySignals([row("short", { dwellMs: 16_000 }), row("long", { chars: 716, dwellMs: 16_000 })]);
  assert.deepEqual(s.liked.map((e) => e.title), ["short"]);
  assert.ok(charsPerSec(716, 16_000) > READ_CPS);
  // Flinging past a long card takes longer, and still counts as a skip.
  const fast = classifySignals([row("read", { dwellMs: 20_000 }), row("long pass", { chars: 900, dwellMs: 3_000 }), row("short look", { chars: 150, dwellMs: 1_000 })]);
  assert.deepEqual(fast.skipped.map((e) => e.title), ["long pass"]);
  assert.ok(charsPerSec(900, 3_000) >= SKIP_CPS && charsPerSec(150, 1_000) < SKIP_CPS);
});

test("a fast pass is a skip only in a tier Gipi was reading that day", () => {
  const s = classifySignals([
    row("read this", { dwellMs: 20_000 }),
    row("passed in food", { dwellMs: 500 }),
    row("passed in life", { tier: "life", dwellMs: 500 }), // flung past the whole tier
    row("passed other day", { digestId: "d2", dwellMs: 500 }),
    row("never reached", { seenCount: 0 }),
  ]);
  assert.deepEqual(s.skipped.map((e) => e.title), ["passed in food"]);
  assert.equal(s.skipped[0].how, "直接滑過");
});

test("video cards: summary length counts, and only opening the video is a click", () => {
  const summary = {
    oneLiner: "一".repeat(100),
    keyPoints: [{ t: 1, point: "二".repeat(200) }],
    quotes: [{ t: 2, text: "三".repeat(100) }],
    hook: "四".repeat(50),
    verdict: "segments" as const,
    verdictReason: "五".repeat(40),
    segments: [{ from: 1, to: 2, why: "六".repeat(10) }],
  };
  const chars = videoChars("標題", summary);
  assert.equal(chars, 502);
  assert.equal(videoChars("標題", null), 2);
  assert.deepEqual(
    classifyVideos([
      { chars, dwellMs: 14_000, seenCount: 1, clicks: 0 }, // 36 字/秒: read the summary
      { chars, dwellMs: 8_000, seenCount: 1, clicks: 0 }, // 63 字/秒: skimmed
      { chars, dwellMs: 0, seenCount: 0, clicks: 1 }, // opened from the list without scrolling to it
    ]),
    { seen: 2, read: 1, opened: 1 },
  );
});

test("cold start: no prompt section until enough has been read", () => {
  const few = classifySignals(Array.from({ length: MIN_LIKED - 1 }, (_, i) => row(`t${i}`, { clicks: 1 })));
  assert.equal(readingSignalsPrompt(few), "");
  const enough = classifySignals([
    ...Array.from({ length: MIN_LIKED }, (_, i) => row(`t${i}`, { clicks: 1 })),
    row("skipped one", { dwellMs: 200 }),
  ]);
  const p = readingSignalsPrompt(enough);
  assert.match(p, /# 近期閱讀行為/);
  assert.match(p, /- \[🍔 餐飲・飲料產業\] t0｜NRN（點開原文）/);
  assert.match(p, /## 直接滑過（1 篇/);
  assert.match(p, /skipped one/);
});
