import { MODELS, generateJSON } from "../lib/anthropic";
import type { Candidate, SelectedArticle, TierConfig } from "../lib/types";

// Stage 2: for the chosen candidates of a tier (now with full text), produce
// the two-part output (SPEC §4.1): objective fact summary (with concrete data)
// + a one-line opinion hook tied to Gipi's recurring lenses.

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          sourceName: { type: "string" },
          sourceDate: { type: "string" },
          factSummary: { type: "string" },
          opinionHook: { type: "string" },
        },
        required: ["url", "title", "sourceName", "sourceDate", "factSummary", "opinionHook"],
      },
    },
  },
  required: ["articles"],
} as const;

interface SummaryResult {
  articles: {
    url: string;
    title: string;
    sourceName: string;
    sourceDate: string;
    factSummary: string;
    opinionHook: string;
  }[];
}

export async function summarizeTier(opts: {
  tier: TierConfig;
  selected: Candidate[];
  today: string;
}): Promise<SelectedArticle[]> {
  const { tier, selected, today } = opts;
  if (selected.length === 0) return [];

  const docs = selected
    .map(
      (c, i) =>
        `## [${i}] ${c.title}\nURL：${c.url}\n來源：${c.sourceName ?? "?"}｜原始日期：${c.publishedDate ?? "?"}\n內文：\n${(c.fullText ?? c.snippet ?? "").slice(0, 4000)}`,
    )
    .join("\n\n");

  const system =
    "你是游舒帆（Gipi）的內容分析助理。今天是 " +
    today +
    "（台北時間）。為每篇文章產出兩段：\n" +
    "1. 事實摘要：客觀、含具體數據與雙方立場，不帶評論。\n" +
    "2. 觀點 Hook：一句話，連結游舒帆的關注脈絡（商業思維、教練式領導、學習與成長、K 型差距、『主管是教練不是球員』、AI 改變組織、長線複利）。\n" +
    "繁體中文輸出。標題可潤飾得更精準有力，但不誇大。sourceDate 用 YYYY-MM-DD。";

  const user = `# 區塊：${tier.emoji} ${tier.label}\n切角：${tier.scope}\n\n# 文章（共 ${selected.length} 篇）\n${docs}\n\n請為每篇回傳 url（原始）、title、sourceName、sourceDate、factSummary、opinionHook。`;

  const result = await generateJSON<SummaryResult>({
    model: MODELS.summarize,
    system,
    user,
    schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 8000,
  });

  // Align back to the selected candidates by url so we keep the full URL list.
  const byUrl = new Map(selected.map((c) => [c.url, c]));
  const out: SelectedArticle[] = [];
  for (const a of result.articles) {
    const src = byUrl.get(a.url);
    const urls = src ? [src.url] : [a.url];
    out.push({
      tier: tier.key,
      title: a.title || src?.title || "",
      sourceName: a.sourceName || src?.sourceName || "",
      sourceDate: a.sourceDate || (src?.publishedDate ?? "").slice(0, 10),
      factSummary: a.factSummary,
      opinionHook: a.opinionHook,
      urls,
    });
  }
  return out;
}
