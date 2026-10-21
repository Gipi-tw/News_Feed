import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIP_BYTES, digestEmail } from "./digest-email";
import type { DigestView } from "./digest-data";
import type { TierConfig } from "./types";

const tiers = [
  { key: "corp", emoji: "🏢", label: "企業動態：國際科技巨頭", tierClass: "tier0" },
  { key: "food", emoji: "🍔", label: "餐飲・飲料產業", tierClass: "tier4" },
] as TierConfig[];

const article = (tier: string, position: number, title: string) => ({
  id: `${tier}${position}`, tier, position, title, sourceName: "Fortune", sourceDate: "2026-10-21",
  factSummary: "事實摘要", opinionHook: "觀點", urls: [`https://example.com/${tier}/${position}?a=1&b=2`], tags: [],
  myComment: "", commentStatus: "draft", lintReport: null,
});

const summary = {
  oneLiner: "一句話", hook: "對你來說", verdict: "segments", verdictReason: "r",
  keyPoints: [{ t: 754, point: "重點" }], quotes: [], segments: [{ from: 60, to: 180, why: "為什麼" }],
};

function view(videoCount = 1, pointText = "重點"): DigestView {
  return {
    id: "d1", date: "2026-10-22", edition: 1, title: "", status: "", createdAt: new Date(), notes: ["全份「以 AI 為主軸」12 則（上限 15）"],
    articles: [article("food", 1, "Starbucks <union> & wages"), article("corp", 2, "B"), article("corp", 1, "A")],
    videos: [
      ...Array.from({ length: videoCount }, (_, i) => ({
        id: `vid${i}`, channelName: "YC", title: `Talk ${i}`, durationSec: 3723, publishedAt: null, status: "summarized",
        summary: { ...summary, keyPoints: [{ t: 754, point: pointText }] },
      })),
      { id: "nt", channelName: "JRE", title: "No captions", durationSec: 9000, publishedAt: null, status: "no_transcript", summary: null },
    ],
  } as unknown as DigestView;
}

test("digest email: tiers in config order with running numbers, escaped text, working links", () => {
  const { subject, html, text, compactVideos } = digestEmail(view(), tiers, "https://site/digest/d1");
  assert.equal(subject, "📰 內容摘要日報 10/22｜3 篇＋🎬 1 支");
  assert.equal(compactVideos, false);
  const order = ["01</span> <a href=\"https://example.com/corp/1", "02</span> <a href=\"https://example.com/corp/2", "03</span> <a href=\"https://example.com/food/1"];
  const at = order.map((s) => html.indexOf(s.replace(/&/g, "&amp;")));
  assert.ok(at.every((i) => i > 0) && at[0] < at[1] && at[1] < at[2], `order ${at}`);
  assert.ok(html.includes("Starbucks &lt;union&gt; &amp; wages"));
  assert.ok(html.includes("?a=1&amp;b=2"));
  assert.ok(html.includes('href="https://www.youtube.com/watch?v=vid0&amp;t=754s"'), "timestamp link");
  assert.ok(html.includes(">1:00–3:00</a>"), "segment link");
  assert.ok(html.includes("No captions") && html.includes("沒有字幕"));
  assert.ok(html.includes("全份「以 AI 為主軸」12 則"));
  assert.ok(text.includes("01 A") && text.includes("03 Starbucks <union> & wages"));
});

test("digest email: videos shrink to one line each when the full email would be clipped", () => {
  const big = view(40, "很長的重點".repeat(200));
  const { html, compactVideos } = digestEmail(big, tiers, "https://site/digest/d1");
  assert.equal(compactVideos, true);
  assert.ok(Buffer.byteLength(html) < CLIP_BYTES);
  assert.ok(!html.includes("很長的重點") && html.includes("Talk 39"));
});
