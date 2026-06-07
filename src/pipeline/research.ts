import { MODELS, client } from "../lib/anthropic";
import type { DigestConfig, SelectedArticle, TierConfig } from "../lib/types";

// Claude-native research stage: instead of a separate search provider, Claude's
// server-side web_search tool finds + reads recent news, then returns the
// selected, summarized articles via a `submit_selection` client tool. This
// collapses search → select → fetch → summarize into one agentic call per tier
// and removes the dependency on a paid third-party search API.

const SUBMIT_TOOL = {
  name: "submit_selection",
  description:
    "提交本區塊最終選出並摘要好的文章清單。只在完成搜尋與閱讀後呼叫一次。",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      articles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", description: "精準有力、不誇大的標題" },
            sourceName: { type: "string", description: "來源媒體名" },
            sourceDate: { type: "string", description: "原始發布日期 YYYY-MM-DD" },
            factSummary: { type: "string", description: "客觀事實摘要，含具體數據與雙方立場" },
            opinionHook: { type: "string", description: "一句話觀點切角，連結 Gipi 的關注脈絡" },
            urls: {
              type: "array",
              items: { type: "string" },
              description: "原始來源 URL（主來源在前），須為搜尋到的真實連結",
            },
          },
          required: ["title", "sourceName", "sourceDate", "factSummary", "opinionHook", "urls"],
        },
      },
    },
    required: ["articles"],
  },
};

interface SubmitInput {
  articles: {
    title: string;
    sourceName: string;
    sourceDate: string;
    factSummary: string;
    opinionHook: string;
    urls: string[];
  }[];
}

export async function researchTier(opts: {
  tier: TierConfig;
  recentTitles: string[];
  interestProfile: string;
  today: string;
  cfg: DigestConfig;
}): Promise<SelectedArticle[]> {
  const { tier, recentTitles, interestProfile, today, cfg } = opts;

  const system =
    "你是游舒帆（Gipi）的個人內容策展編輯。今天是 " +
    today +
    "（台北時間）。用 web_search 工具搜尋最近 " +
    cfg.search.freshnessHours +
    " 小時內、最符合本區塊定位、最值得 Gipi 評論的新聞。" +
    "嚴格遵守區塊定位與全域排除規則；同一事件（不同來源）只收一則，持續事件只收新進展。" +
    "為每篇產出：客觀事實摘要（含具體數據）＋ 一句觀點 Hook（連結商業思維／教練式領導／學習成長／AI 改變組織／長線複利）。" +
    "完成後呼叫 submit_selection 回傳，繁體中文。英文來源請以繁中摘要。";

  const user = `# 本區塊：${tier.emoji} ${tier.label}
定位與切角：${tier.scope}
需要選出：${tier.count} 則（盡量足額）
建議查詢方向（可自行調整、可中英並用）：
${tier.queries.map((q) => `- ${q}`).join("\n")}

# 全域排除規則（命中不選）
${cfg.globalExclusions.map((e) => `- ${e}`).join("\n")}

# 興趣輪廓（節錄，判斷相關性用）
${interestProfile.slice(0, 3000)}

# 近 30 天已發過的標題（避免重複；同事件僅收新進展）
${recentTitles.length ? recentTitles.slice(0, 80).map((t) => `- ${t}`).join("\n") : "（無）"}

請先用 web_search 搜尋並閱讀，挑出最多 ${tier.count} 則，最後呼叫 submit_selection 提交。`;

  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 8 },
    SUBMIT_TOOL,
  ];

  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: user },
  ];

  // The SDK auto-runs the server-side web_search loop within a turn; the model
  // pauses (stop_reason "pause_turn") if it hits the server-tool iteration cap,
  // and stops with "tool_use" when it calls submit_selection.
  for (let round = 0; round < 5; round++) {
    const res = await client().messages.create({
      model: MODELS.summarize,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
    });

    const submit = res.content.find(
      (b) => b.type === "tool_use" && b.name === "submit_selection",
    );
    if (submit && submit.type === "tool_use") {
      const input = submit.input as SubmitInput;
      return input.articles.slice(0, tier.count).map((a) => ({
        tier: tier.key,
        title: a.title,
        sourceName: a.sourceName,
        sourceDate: a.sourceDate,
        factSummary: a.factSummary,
        opinionHook: a.opinionHook,
        urls: (a.urls ?? []).filter(Boolean),
      }));
    }

    // Continue the server-tool loop, or nudge toward submitting.
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "pause_turn") {
      messages.push({
        role: "user",
        content: "請依目前搜尋到的結果呼叫 submit_selection 提交最終選文。",
      });
    }
  }

  return [];
}
