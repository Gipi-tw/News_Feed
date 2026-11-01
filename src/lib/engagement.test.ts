import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_LIKED, classifySignals, parseDeltas, readingSignalsPrompt, type SignalRow } from "./engagement";

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

test("liked = opened, copied or read ≥ 8s; opening outranks reading time", () => {
  const s = classifySignals([
    row("long read", { dwellMs: 60_000 }),
    row("opened", { clicks: 1, dwellMs: 3_000 }),
    row("glanced", { dwellMs: 4_000 }), // neither liked nor skipped
    row("copied", { copies: 1 }),
  ]);
  assert.deepEqual(s.liked.map((e) => e.title), ["opened", "copied", "long read"]);
  assert.equal(s.liked[0].how, "點開原文、讀 3 秒");
  assert.equal(s.seen, 4);
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
  assert.equal(s.skipped[0].how, "停不到 2 秒");
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
