import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSameEvent, dropSameEvent, sameEventPrompt } from "./same-event";
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
  assert.deepEqual(dropped, { sameEvent: [1, 1], repeated: [0, 0] });
});

test("same event: equal ranks keep the earlier tier; bad ids and singletons are ignored", () => {
  const pools = [{ ranked: ["a0", "a1"] }, { ranked: ["b0", "b1"] }];
  const dropped = dropSameEvent(pools, [{ ids: [1, 3] }, { ids: [0, 0, 99] }, { ids: [-1, 2] }]);
  assert.deepEqual(pools[0].ranked, ["a0", "a1"]);
  assert.deepEqual(pools[1].ranked, ["b0"]);
  assert.deepEqual(dropped, { sameEvent: [0, 1], repeated: [0, 0] });
});

test("repeats of a published event all go, even a group's best-ranked member", () => {
  const pools = [{ ranked: ["corp-0", "corp-1"] }, { ranked: ["food-0", "food-1", "food-2"] }];
  // food-0 repeats 10/31's story and food-2 is the same event as food-0;
  // corp-1 is a repeat on its own; 99 is out of range.
  const dropped = dropSameEvent(pools, [{ ids: [2, 4] }], [2, 1, 99]);
  assert.deepEqual(pools[0].ranked, ["corp-0"]);
  assert.deepEqual(pools[1].ranked, ["food-1"]);
  assert.deepEqual(dropped, { sameEvent: [0, 1], repeated: [1, 1] });
});

test("the prompt lists published items as [P…] with their date, before today's picks", () => {
  const { user } = sameEventPrompt(
    [{ title: "Starbucks explores personalized AI menus for drive-thru", sourceName: "UA.NEWS", snippet: "The Verge reports…" }],
    [{ date: "2026-10-31", title: "星巴克想用AI在得來速顯示個人化數位菜單", sourceName: "The Verge", snippet: "星巴克  正在\n測試" }],
  );
  assert.equal(
    user,
    "# 最近幾天已刊出（共 1 則，格式：[P編號] 日期｜標題｜來源｜摘要）\n" +
      "[P0] 10-31｜星巴克想用AI在得來速顯示個人化數位菜單｜The Verge｜星巴克 正在 測試\n\n" +
      "# 今天候選（共 1 則，格式：[編號] 標題｜來源｜摘要）\n" +
      "[0] Starbucks explores personalized AI menus for drive-thru｜UA.NEWS｜The Verge reports…",
  );
  assert.ok(!sameEventPrompt([{ title: "a" }, { title: "b" }], []).user.includes("已刊出"));
});

test("groups and repeats that point at nothing are dropped", () => {
  const res = cleanSameEvent(
    {
      groups: [{ event: "ok", ids: [0, 1] }, { event: "one real", ids: [1, 7] }],
      repeats: [
        { event: "ok", id: 2, published: 0 },
        { event: "no such pick", id: 3, published: 0 },
        { event: "no such published", id: 0, published: 5 },
      ],
    },
    3,
    2,
  );
  assert.deepEqual(res.groups.map((g) => g.event), ["ok"]);
  assert.deepEqual(res.repeats.map((r) => r.event), ["ok"]);
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
  const repeatNotes = buildNotes(
    cfg,
    [{ tier, shortfallNote: "", unmetMins: [], trimmed: [], repeated: 2 }],
    [{ tier: "food", tags: [] }],
  );
  assert.deepEqual(repeatNotes, ["🍽️ 餐飲 1/3 篇：2 則最近幾天已出過，已刪除"]);
});
