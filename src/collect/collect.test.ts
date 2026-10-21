import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "./feed";
import { canonicalUrl, htmlToText, stripPublisherSuffix, titleKey } from "./text";
import { keywordMatcher, tierHints } from "./prefilter";
import { googleNewsArticleId, googleNewsSearchUrl, isGoogleNewsLink } from "./gnews";
import { fallbackQueries } from "../pipeline/candidates";
import { publisherBlocker } from "./blocklist";

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

test("Atom relative entry links resolve against the feed's site link (real HBR shape)", () => {
  const xml = `<ns6:feed xmlns:ns6="http://www.w3.org/2005/Atom">
    <ns6:link href="http://hbr.org" rel="alternate" type="text/html"/>
    <ns6:link href="site.hostname/x.xml" rel="self"/>
    <ns6:entry><ns6:title>Risk Preparedness</ns6:title>
      <ns6:link href="/2026/10/risk-preparedness" rel="alternate" type="text/html"/>
      <ns6:summary><![CDATA[<p>How companies can use disclosures.</p>]]></ns6:summary>
      <ns6:published>2026-10-09T12:15:25Z</ns6:published></ns6:entry>
  </ns6:feed>`;
  const [e] = parseFeed(xml, "http://feeds.hbr.org/harvardbusiness");
  assert.equal(e.link, "http://hbr.org/2026/10/risk-preparedness");
  assert.equal(e.summary, "How companies can use disclosures.");
});

test("zoneless dates (iThome) use the feed's timezone; future dates are dropped", () => {
  const xml = (d: string) =>
    `<rss><channel><item><title>T</title><link>https://www.ithome.com.tw/news/1</link><pubDate>${d}</pubDate></item></channel></rss>`;
  // iThome writes Taipei local time with no zone (note the double space).
  assert.equal(parseFeed(xml("2026-10-21  10:10:21"), undefined, "+08:00")[0].publishedAt?.toISOString(), "2026-10-21T02:10:21.000Z");
  // A zoned date ignores the feed timezone.
  assert.equal(parseFeed(xml("Tue, 21 Oct 2026 02:10:21 GMT"), undefined, "+08:00")[0].publishedAt?.toISOString(), "2026-10-21T02:10:21.000Z");
  // Far-future dates are treated as unknown (falls back to fetch time).
  assert.equal(parseFeed(xml("Tue, 21 Oct 2099 02:10:21 GMT"))[0].publishedAt, null);
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

test("blocked publishers: exact name (any case) or domain incl. subdomains", () => {
  const blocked = publisherBlocker(["MSN", "36Kr", "36kr.com", "蕃新聞"]);
  assert.equal(blocked("msn"), true);
  assert.equal(blocked("MSNBC"), false); // name match is exact, not substring
  assert.equal(blocked("蕃新聞"), true);
  assert.equal(blocked("Fortune", "https://eu.36kr.com/en/p/1"), true);
  assert.equal(blocked("Fortune", "https://not36kr.com/x"), false);
  assert.equal(blocked("Fortune", "https://fortune.com/x"), false);
  assert.equal(blocked(null, "not a url"), false);
  const aol = publisherBlocker(["AOL.com"]); // Google News uses the domain as the name
  assert.equal(aol("AOL.com", "https://news.google.com/rss/articles/x"), true);
  assert.equal(aol("Fortune", "https://www.aol.com/finance/x"), true);
  assert.equal(publisherBlocker()("MSN"), false);
});
