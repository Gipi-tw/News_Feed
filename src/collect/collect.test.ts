import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "./feed";
import { canonicalUrl, htmlToText, stripPublisherSuffix, titleKey } from "./text";
import { keywordMatcher, tierHints } from "./prefilter";
import { googleNewsArticleId, googleNewsSearchUrl, isGoogleNewsLink } from "./gnews";
import { fallbackQueries } from "../pipeline/candidates";

test("RSS 2.0: CDATA title, entity-encoded HTML description, tracking params dropped", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
    <item><title><![CDATA[Starbucks & the "third place"]]></title>
      <link>https://example.com/a/?utm_source=rss&amp;id=7#top</link>
      <description>&lt;p&gt;Sales rose &amp;amp; fell&lt;/p&gt;</description>
      <pubDate>Fri, 10 Oct 2026 08:00:00 +0000</pubDate></item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const [e, ...rest] = parseFeed(xml);
  assert.equal(rest.length, 0);
  assert.equal(e.title, 'Starbucks & the "third place"');
  assert.equal(e.link, "https://example.com/a?id=7");
  assert.equal(e.summary, "Sales rose & fell");
  assert.equal(e.publishedAt?.toISOString(), "2026-10-10T08:00:00.000Z");
});

test("Atom with a namespace prefix (HBR serves ns6:entry)", () => {
  const xml = `<ns6:feed xmlns:ns6="http://www.w3.org/2005/Atom">
    <ns6:entry><ns6:title>Managing Up</ns6:title>
      <ns6:link rel="alternate" href="https://hbr.org/2026/10/managing-up"/>
      <ns6:summary>How to manage your boss.</ns6:summary>
      <ns6:published>2026-10-09T14:38:00Z</ns6:published></ns6:entry>
  </ns6:feed>`;
  const [e] = parseFeed(xml);
  assert.equal(e.title, "Managing Up");
  assert.equal(e.link, "https://hbr.org/2026/10/managing-up");
  assert.equal(e.publishedAt?.toISOString(), "2026-10-09T14:38:00.000Z");
});

test("RSS 1.0 / RDF (Slashdot) with dc:date", () => {
  const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel><title>Slashdot</title></channel>
    <item><title>Intel Cuts Managers</title><link>https://it.slashdot.org/story/1</link>
      <description>Story</description><dc:date>2026-10-10T12:32:00+00:00</dc:date></item>
  </rdf:RDF>`;
  const [e] = parseFeed(xml);
  assert.equal(e.title, "Intel Cuts Managers");
  assert.equal(e.publishedAt?.toISOString(), "2026-10-10T12:32:00.000Z");
});

test("Google News: publisher suffix stripped, source captured", () => {
  const xml = `<rss><channel><item><title>Starbucks names new CFO - Reuters</title>
    <link>https://news.google.com/rss/articles/CBMiAbc?oc=5</link>
    <source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
  const [e] = parseFeed(xml);
  assert.equal(e.title, "Starbucks names new CFO");
  assert.equal(e.publisher, "Reuters");
  assert.ok(isGoogleNewsLink(e.link));
  assert.equal(googleNewsArticleId(e.link), "CBMiAbc");
});

test("text helpers", () => {
  assert.equal(htmlToText("<p>a<br/>b</p><script>x()</script>"), "a b");
  assert.equal(canonicalUrl("https://Example.com/x/?fbclid=1"), "https://example.com/x");
  assert.equal(stripPublisherSuffix("Title - WIRED", "WIRED"), "Title");
  assert.equal(titleKey("Meta, Again: Layoffs!"), titleKey("meta again layoffs"));
});

test("keyword prefilter respects word boundaries and CJK substrings", () => {
  const m = keywordMatcher({ corp: ["Intel", "Meta"], food: ["McDonald's", "星巴克"] });
  assert.deepEqual(m("Artificial intelligence and metadata"), []);
  assert.deepEqual(m("Intel's new CEO"), ["corp"]);
  assert.deepEqual(m("McDonald's franchisees push back"), ["food"]);
  assert.deepEqual(m("星巴克換執行長"), ["food"]);
  assert.deepEqual(tierHints(["life"], "Meta layoffs", m), ["life", "corp"]);
});

test("Google News search URL picks the edition by language and adds a window", () => {
  const zh = googleNewsSearchUrl({ query: "site:bnext.com.tw", lang: "zh-TW" });
  assert.match(zh, /hl=zh-TW&gl=TW&ceid=TW:zh-Hant$/);
  assert.match(decodeURIComponent(zh), /site:bnext\.com\.tw when:2d/);
  const fb = fallbackQueries({
    key: "life", emoji: "", label: "生活版", subtitle: "", count: 7, tierClass: "", scope: "",
    queries: ["心理學 焦慮", "parenting study"],
  });
  assert.deepEqual(fb.map((q) => q.lang), ["zh-TW", "en-US"]);
});
