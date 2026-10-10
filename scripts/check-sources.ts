// Source health check: fetch + parse every configured feed and Google News
// query, report counts / freshness / keyword-prefilter hits, and try decoding
// a couple of Google News links. No DB, no LLM — safe to run anywhere; run it
// from a cloud IP (CI) since local network results don't reflect prod.
//   npx tsx scripts/check-sources.ts
import { appendFileSync, readFileSync } from "node:fs";
import type { DigestConfig } from "../src/lib/types";
import { parseFeed } from "../src/collect/feed";
import { decodeGoogleNewsUrl, googleNewsSearchUrl } from "../src/collect/gnews";
import { keywordMatcher, tierHints } from "../src/collect/prefilter";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

async function main() {
  const cfg = JSON.parse(readFileSync("config/digest_config.json", "utf8")) as DigestConfig;
  const src = cfg.sources!;
  const match = keywordMatcher(src.keywords);
  const since = Date.now() - cfg.search.freshnessHours * 3_600_000;
  const rows: string[] = [];
  const gnLinks: string[] = [];
  let bad = 0;

  const all = [
    ...src.feeds.map((f) => ({ key: f.key, url: f.url, tiers: f.tiers })),
    ...src.googleNews.map((q) => ({ key: q.key, url: googleNewsSearchUrl(q), tiers: q.tiers })),
  ];
  for (const s of all) {
    try {
      const res = await fetch(s.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = parseFeed(await res.text());
      const recent = entries.filter((e) => (e.publishedAt?.getTime() ?? Date.now()) >= since);
      const hinted = recent.filter((e) => tierHints(s.tiers, `${e.title} ${e.summary}`, match).length);
      const newest = entries.reduce((m, e) => Math.max(m, e.publishedAt?.getTime() ?? 0), 0);
      if (s.key.startsWith("gn-") && entries[0]) gnLinks.push(entries[0].link);
      if (!entries.length) bad++;
      rows.push(
        `| ${s.key} | ${entries.length ? "✅" : "⚠️"} | ${entries.length} | ${recent.length} | ${hinted.length} | ${newest ? new Date(newest).toISOString().slice(0, 16) : "—"} | ${(entries[0]?.title ?? "").slice(0, 50).replace(/\|/g, "／")} |`,
      );
    } catch (e) {
      bad++;
      rows.push(`| ${s.key} | ❌ ${(e as Error).message.slice(0, 40)} | | | | | |`);
    }
    if (s.key.startsWith("gn-")) await new Promise((r) => setTimeout(r, 700));
  }

  const decoded: string[] = [];
  for (const l of gnLinks.slice(0, 3)) decoded.push(`- ${(await decodeGoogleNewsUrl(l)) ?? "❌ 解不出來"}`);

  const md = [
    `## 來源健康檢查（${all.length} 個來源，${bad} 個有問題）`,
    "",
    `「近期」= ${cfg.search.freshnessHours} 小時內；「會評分」= 近期且通過來源／關鍵字初篩。`,
    "",
    "| 來源 | 狀態 | 總數 | 近期 | 會評分 | 最新 (UTC) | 第一則標題 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "Google News 連結解碼：",
    ...decoded,
    "",
  ].join("\n");
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
