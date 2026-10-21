import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, parseRelativeTime, parseVideosTab, watchUrl } from "./youtube";
import { compactTranscript } from "./supadata";
import { dailyAllowance, daysLeftInMonth } from "./index";

const NOW = Date.parse("2026-10-21T04:00:00Z");

test("parseDuration", () => {
  assert.equal(parseDuration("1:34:20"), 5660);
  assert.equal(parseDuration("14:56"), 896);
  assert.equal(parseDuration("UPCOMING"), 0);
  assert.equal(parseDuration(""), 0);
});

test("parseRelativeTime handles short and long forms; months are not minutes", () => {
  assert.equal(parseRelativeTime("14h ago", NOW)?.toISOString(), "2026-10-20T14:00:00.000Z");
  assert.equal(parseRelativeTime("2 days ago", NOW)?.toISOString(), "2026-10-19T04:00:00.000Z");
  assert.equal(parseRelativeTime("Streamed 3w ago", NOW)?.toISOString(), "2026-09-30T04:00:00.000Z");
  assert.equal(parseRelativeTime("5 minutes ago", NOW)?.toISOString(), "2026-10-21T03:55:00.000Z");
  assert.ok(parseRelativeTime("1mo ago", NOW)!.getTime() < NOW - 20 * 86_400_000);
  assert.equal(parseRelativeTime("yesterday", NOW), null);
});

test("parseVideosTab reads both renderer generations from ytInitialData", () => {
  const data = {
    contents: {
      a: { videoRenderer: { videoId: "AAA", title: { runs: [{ text: "Old style" }] }, lengthText: { simpleText: "1:02:03" }, publishedTimeText: { simpleText: "2d ago" } } },
      b: {
        lockupViewModel: {
          contentId: "BBB",
          contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
          contentImage: { overlay: { badge: { text: "21:05" } } },
          metadata: { lockupMetadataViewModel: { title: { content: "New style" }, rows: [{ parts: [{ content: "18h ago" }] }] } },
        },
      },
      c: { lockupViewModel: { contentId: "PL1", contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST" } },
    },
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
  const vids = parseVideosTab(html, NOW);
  assert.deepEqual(vids.map((v) => [v.id, v.title, v.durationSec]), [["AAA", "Old style", 3723], ["BBB", "New style", 1265]]);
  assert.equal(vids[1].publishedAt?.toISOString(), "2026-10-20T10:00:00.000Z");
  assert.deepEqual(parseVideosTab("<html>no data</html>"), []);
});

test("compactTranscript merges captions into ~30s timestamped lines", () => {
  const lines = compactTranscript([
    { text: "Hello  there.", offset: 0 },
    { text: "Welcome back.", offset: 4000 },
    { text: "", offset: 9000 },
    { text: "Next topic", offset: 31000 },
  ]);
  assert.deepEqual(lines, [[0, "Hello there. Welcome back."], [31, "Next topic"]]);
});

test("daily Supadata allowance spreads the month's points", () => {
  assert.equal(daysLeftInMonth("Asia/Taipei", new Date("2026-10-21T04:00:00Z")), 11); // Oct 21–31
  assert.equal(dailyAllowance(95, 11), 9);
  assert.equal(dailyAllowance(3, 11), 1); // keep going while any remain
  assert.equal(dailyAllowance(0, 11), 0);
  assert.equal(watchUrl("abc", 754.6), "https://www.youtube.com/watch?v=abc&t=754s");
});
