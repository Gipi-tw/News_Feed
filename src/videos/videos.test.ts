import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, parseRelativeTime, parseVideosTab, watchUrl } from "./youtube";
import { compactTranscript } from "./supadata";
import { dailyAllowance, daysLeftInMonth, interleaveByChannel } from "./index";
import { anchorLocator, tidySummary } from "./summarize";

const LINES: [number, string][] = [
  [0, "Welcome back. Today we talk about the Hugging Face breach and AI safety."],
  [30, "So like the hugging face breach is another fact versus fiction thing"],
  [369, "If you look at the Slashdot headline, OpenAI says its AI models acted"],
  [399, "on its own. OpenAI never said that. Not in one statement."],
  [1930, "formal methods give us guarantees about the hugging face breach too"],
];

test("anchor moves a timestamp to the line that says it, nearest the guess when repeated", () => {
  const locate = anchorLocator(LINES);
  assert.equal(locate("the Slashdot headline, OpenAI says", 1930), 369);
  assert.equal(locate("AI models acted on its own", 0), 369); // spans two lines → where it starts
  assert.equal(locate("hugging face breach", 1900), 1930);
  assert.equal(locate("hugging face breach", 10), 0);
  assert.equal(locate("yeah so", 369), null); // too short to trust
  assert.equal(locate("words that are not there at all", 369), null);
});

test("tidySummary: anchored times, video order, merged segments, no anchors stored", () => {
  const { summary, anchored, total } = tidySummary(
    {
      oneLiner: "x",
      hook: "對你來說",
      verdict: "segments",
      verdictReason: "r",
      keyPoints: [
        { anchor: "OpenAI never said that", t: 1930, point: "late" },
        { anchor: "Welcome back. Today we talk", t: 5, point: "early" },
      ],
      quotes: [{ anchor: "no such words anywhere here", t: 9999, text: "q" }],
      segments: [
        { anchor: "formal methods give us guarantees", from: 1900, to: 2100, why: "b" },
        { anchor: "the Slashdot headline", from: 300, to: 500, why: "a1" },
        { anchor: "never said that. Not in one", from: 400, to: 600, why: "a2" },
      ],
    },
    LINES,
    2000,
  );
  assert.deepEqual(summary.keyPoints, [{ t: 0, point: "early" }, { t: 399, point: "late" }]);
  assert.deepEqual(summary.quotes, [{ t: 2000, text: "q" }]); // not found → clamped into the video
  assert.deepEqual(summary.segments, [
    { from: 369, to: 599, why: "a1；a2" },
    { from: 1930, to: 2000, why: "b" },
  ]);
  assert.deepEqual([anchored, total], [5, 6]);
  assert.equal(JSON.stringify(summary).includes("anchor"), false);
});

test("channels take turns; videos with a transcript go first", () => {
  const v = (id: string, channelKey: string, transcript: string | null = null) => ({ id, channelKey, transcript });
  const order = interleaveByChannel([
    v("ps1", "product-school"), v("ps2", "product-school"), v("jre1", "jre"),
    v("ps3", "product-school"), v("doac1", "doac"), v("yc1", "yc", "[[0,\"hi\"]]"),
  ]);
  assert.deepEqual(order.map((x) => x.id), ["yc1", "ps1", "jre1", "doac1", "ps2", "ps3"]);
});

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
