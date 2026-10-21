import { test } from "node:test";
import assert from "node:assert/strict";
import { dropSameEvent } from "./same-event";
import { buildNotes } from "./notes";
import type { DigestConfig, TierConfig } from "../lib/types";

test("same event: the best-ranked report stays, the others go", () => {
  const pools = [
    { ranked: ["corp-0", "corp-1", "corp-2"] }, // flat 0–2
    { ranked: ["food-0", "food-1", "food-2", "food-3"] }, // flat 3–6
  ];
  // food-1 + food-3 (same tier); corp-2 + food-0 (cross-tier: food-0 ranks higher)
  const dropped = dropSameEvent(pools, [{ ids: [6, 4] }, { ids: [2, 3] }]);
  assert.deepEqual(pools[0].ranked, ["corp-0", "corp-1"]);
  assert.deepEqual(pools[1].ranked, ["food-0", "food-1", "food-2"]);
  assert.deepEqual(dropped, [1, 1]);
});

test("same event: equal ranks keep the earlier tier; bad ids and singletons are ignored", () => {
  const pools = [{ ranked: ["a0", "a1"] }, { ranked: ["b0", "b1"] }];
  const dropped = dropSameEvent(pools, [{ ids: [1, 3] }, { ids: [0, 0, 99] }, { ids: [-1, 2] }]);
  assert.deepEqual(pools[0].ranked, ["a0", "a1"]);
  assert.deepEqual(pools[1].ranked, ["b0"]);
  assert.deepEqual(dropped, [0, 1]);
});

test("a tier left short by same-event removals says so in the footer", () => {
  const tier = { key: "food", emoji: "🍽️", label: "餐飲：國際", count: 3, rules: [] } as unknown as TierConfig;
  const cfg = { tiers: [tier], globalRules: [] } as unknown as DigestConfig;
  const notes = buildNotes(
    cfg,
    [{ tier, shortfallNote: "", unmetMins: [], trimmed: [], deduped: 1 }],
    [{ tier: "food", tags: [] }, { tier: "food", tags: [] }],
  );
  assert.deepEqual(notes, ["🍽️ 餐飲 2/3 篇：1 則和其他文章是同一事件，已刪除"]);
});
