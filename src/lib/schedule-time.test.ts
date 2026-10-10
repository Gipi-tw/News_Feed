import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSlotStart, localMinutes, parseDailyCron } from "./schedule-time";

test("parseDailyCron accepts daily M H * * * only", () => {
  assert.equal(parseDailyCron("0 8 * * *"), 480);
  assert.equal(parseDailyCron(" 30 23 * * * "), 1410);
  assert.equal(parseDailyCron("0 8 * * 1"), null);
  assert.equal(parseDailyCron("0 24 * * *"), null);
  assert.equal(parseDailyCron("*/5 * * * *"), null);
});

test("localMinutes uses the given time zone (Taipei is UTC+8)", () => {
  assert.equal(localMinutes("Asia/Taipei", new Date("2026-10-10T00:05:00Z")), 8 * 60 + 5);
});

test("dueSlotStart: inside the grace window returns today's slot time", () => {
  const now = new Date("2026-10-10T01:30:20Z"); // 09:30:20 Taipei
  const start = dueSlotStart(480, 240, "Asia/Taipei", now);
  assert.equal(start?.toISOString(), "2026-10-10T00:00:00.000Z"); // 08:00 Taipei
});

test("dueSlotStart: before the slot or after the grace window is not due", () => {
  assert.equal(dueSlotStart(480, 240, "Asia/Taipei", new Date("2026-10-09T23:59:00Z")), null); // 07:59
  assert.equal(dueSlotStart(480, 240, "Asia/Taipei", new Date("2026-10-10T04:00:00Z")), null); // 12:00
});
