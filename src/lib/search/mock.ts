import type { SearchHit } from "../types";
import type { SearchOptions, SearchProvider } from "./provider";

// Offline provider for local dev / CI when no search key is configured.
// Synthesizes deterministic, plausible hits per query so the full pipeline
// (select → summarize → comment → lint → assemble) can run end-to-end.
const SOURCES = [
  "Fortune",
  "Bloomberg",
  "The Verge",
  "TechCrunch",
  "INSIDE",
  "數位時代",
  "TechNews",
  "經理人",
  "Reuters",
  "The Information",
];

const ANGLES = [
  "最新進展與數據",
  "組織與人才動態",
  "領導者公開發言",
  "商業模式轉變",
  "市場反應與分析",
];

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export class MockProvider implements SearchProvider {
  readonly name = "mock";
  readonly available = true;

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    for (let i = 0; i < opts.count; i++) {
      const seed = hashInt(`${query}#${i}`);
      const source = SOURCES[seed % SOURCES.length];
      const angle = ANGLES[(seed >> 3) % ANGLES.length];
      const hoursAgo = (seed % Math.max(1, opts.freshnessHours));
      const date = new Date(Date.now() - hoursAgo * 3600_000);
      hits.push({
        title: `[Mock] ${query.split(" OR ")[0].trim()}：${angle}（#${i + 1}）`,
        url: `https://example.com/mock/${seed}`,
        snippet:
          `這是一則用於本機測試的模擬新聞。主題關鍵字為「${query}」，切角為「${angle}」。` +
          `內容包含若干虛構但結構完整的事實陳述，足以讓摘要與評論流程跑通：` +
          `某科技公司本週宣布相關決策，影響其組織設計與人才策略，數據顯示變化幅度約為兩成。`,
        sourceName: source,
        publishedDate: date.toISOString(),
        query,
      });
    }
    return hits;
  }
}
