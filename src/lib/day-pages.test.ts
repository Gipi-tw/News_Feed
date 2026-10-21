import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDays } from "./digest-data";
import { DATE_RE, dayHref, dayLabel, monthDay, weekday } from "./date";

test("digests group by day, newest day first, editions in order", () => {
  const days = groupDays([
    { id: "c", date: "2026-10-21", edition: 2, count: 45 },
    { id: "b", date: "2026-10-21", edition: 1, count: 40 },
    { id: "a", date: "2026-10-19", edition: 1, count: 12 },
    { id: "d", date: "2026-10-22", edition: 1, count: 45 },
  ]);
  assert.deepEqual(days.map((d) => [d.date, d.editions.map((e) => e.id)]), [
    ["2026-10-22", ["d"]],
    ["2026-10-21", ["b", "c"]],
    ["2026-10-19", ["a"]],
  ]);
});

test("day URLs: the latest edition gets the plain date", () => {
  assert.equal(dayHref("2026-10-21"), "/2026-10-21");
  assert.equal(dayHref("2026-10-21", 2, 2), "/2026-10-21");
  assert.equal(dayHref("2026-10-21", 1, 2), "/2026-10-21?e=1");
  assert.ok(DATE_RE.test("2026-10-21"));
  assert.ok(!DATE_RE.test("history") && !DATE_RE.test("2026-10-21x"));
});

test("short date labels: weekday always, year only when it isn't this year", () => {
  assert.equal(weekday("2026-10-21"), "三");
  assert.equal(monthDay("2026-01-04"), "1/4");
  assert.equal(dayLabel("2026-10-21", "2026"), "10/21（三）");
  assert.equal(dayLabel("2025-12-31", "2026"), "2025/12/31（三）");
});
