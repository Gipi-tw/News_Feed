import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceQuotas, pickWithRules, withMax } from "./quota";
import { mapSelection } from "./select";

const item = (id: string, ...tags: string[]) => ({ id, tags });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");

test("fills by rank and stops at count", () => {
  const r = pickWithRules([item("a"), item("b"), item("c")], 2);
  assert.equal(ids(r.picked), "a,b");
  assert.deepEqual(r.unmetMins, []);
});

test("max rule skips extra tagged items and backfills untagged", () => {
  const pool = [item("a", "ai"), item("b", "ai"), item("c", "ai"), item("d"), item("e")];
  const r = pickWithRules(pool, 4, [{ tag: "ai", desc: "", max: 2 }]);
  assert.equal(ids(r.picked), "a,b,d,e");
});

test("min rule pulls lower-ranked tagged items ahead of untagged ones", () => {
  const pool = [item("x1", "other"), item("x2", "other"), item("x3", "other"), item("p1", "psych"), item("p2", "psych")];
  const r = pickWithRules(pool, 3, [
    { tag: "psych", desc: "", min: 2 },
    { tag: "other", desc: "", max: 3 },
  ]);
  assert.equal(ids(r.picked), "x1,p1,p2"); // rank order preserved
});

test("unmet min is reported, never padded (寧缺勿濫)", () => {
  const pool = [item("p1", "psych"), item("o1", "other"), item("o2", "other"), item("o3", "other"), item("o4", "other")];
  const r = pickWithRules(pool, 7, [
    { tag: "psych", desc: "", min: 4 },
    { tag: "other", desc: "", max: 3 },
  ]);
  assert.equal(ids(r.picked), "p1,o1,o2,o3");
  assert.deepEqual(r.unmetMins.map((u) => [u.rule.tag, u.got]), [["psych", 1]]);
});

test("withMax keeps a tighter existing cap", () => {
  const rules = [{ tag: "ai", desc: "AI", max: 2 }];
  assert.equal(withMax(rules, "ai", 5), rules);
  assert.deepEqual(withMax(rules, "ai", 1), [{ tag: "ai", desc: "AI", max: 1 }]);
});

test("global max trims the tier with the most tagged items and backfills", () => {
  const a = [item("a1", "ai"), item("a2", "ai"), item("a3", "ai"), item("a4")];
  const b = [item("b1", "ai"), item("b2"), item("b3")];
  const [ra, rb] = enforceQuotas(
    [
      { key: "A", ranked: a, count: 3 },
      { key: "B", ranked: b, count: 2 },
    ],
    [{ tag: "ai", desc: "", max: 3 }],
  );
  // 4 AI picked (a1,a2,a3,b1) > 3 → tier A capped at 2 AI, backfilled with a4.
  assert.equal(ids(ra.picked), "a1,a2,a4");
  assert.deepEqual(ra.trimmed, [{ tag: "ai", max: 2 }]);
  assert.equal(ids(rb.picked), "b1,b2");
});

test("global max shrinks a tier when its pool has nothing untagged left", () => {
  const a = [item("a1", "ai"), item("a2", "ai")];
  const [ra] = enforceQuotas([{ key: "A", ranked: a, count: 2 }], [{ tag: "ai", desc: "", max: 1 }]);
  assert.equal(ids(ra.picked), "a1");
});

test("selector picks map by candidate number; bad or repeated numbers are skipped; ai_dev / ai_strategy count as ai", () => {
  const c = (n: number) => ({ title: `t${n}`, url: `https://news.google.com/rss/articles/${"x".repeat(200)}${n}`, snippet: "" });
  const candidates = [c(0), c(1), c(2), c(3)];
  const ranked = mapSelection(
    candidates,
    [
      { id: 2, tags: ["ai_dev"] },
      { id: 9, tags: [] }, // no such candidate
      { id: 2, tags: [] }, // repeated
      { id: 0, tags: ["ai"] },
      { id: 1.5 as number, tags: [] },
      { id: 3, tags: ["ai_strategy"] },
      { id: 1, tags: [] }, // past the limit
    ],
    3,
  );
  assert.deepEqual(ranked.map((h) => [h.title, (h.tags ?? []).sort().join(",")]), [["t2", "ai,ai_dev"], ["t0", "ai"], ["t3", "ai,ai_strategy"]]);
});
