import { MODELS, generateJSON } from "../lib/anthropic";
import type { DigestConfig, SearchHit, TierConfig } from "../lib/types";
import { rulesPrompt, tagsSchema } from "./rules-prompt";

// Stage 1: rank the best candidates for a tier from the search hits and tag
// each with topic tags. Returns a pool a few items longer than the tier's
// count so quota enforcement (quota.ts) can backfill after trimming.
// Snippet-based (full text is fetched only for the winners), so the prompt
// stays small even with many candidates.

const SPARE = 4; // extra ranked picks beyond `count`, for quota backfill

function selectSchema(tier: TierConfig, cfg: DigestConfig) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      selected: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            reason: { type: "string" },
            tags: tagsSchema(tier, cfg),
          },
          required: ["url", "title", "reason", "tags"],
        },
      },
      shortfallNote: { type: "string" },
    },
    required: ["selected", "shortfallNote"],
  };
}

interface SelectResult {
  selected: { url: string; title: string; reason: string; tags: string[] }[];
  shortfallNote: string;
}

export interface TierSelection {
  ranked: SearchHit[]; // best first, each with tags
  shortfallNote: string;
}

export async function selectForTier(opts: {
  tier: TierConfig;
  candidates: SearchHit[];
  recentTitles: string[];
  interestProfile: string;
  today: string;
  cfg: DigestConfig;
}): Promise<TierSelection> {
  const { tier, candidates, recentTitles, interestProfile, today, cfg } = opts;
  if (candidates.length === 0) return { ranked: [], shortfallNote: "今日沒有候選" };

  const list = candidates
    .map(
      (c, i) =>
        `[${i}] ${c.title}\n    來源：${c.sourceName ?? "?"}｜日期：${c.publishedDate ?? "?"}｜${c.url}\n    摘要：${(c.snippet ?? "").slice(0, 300)}`,
    )
    .join("\n");

  const system =
    "你是游舒帆（Gipi）的個人內容策展編輯。今天是 " +
    today +
    "（台北時間）。你的任務是依他的興趣輪廓，從候選新聞中挑出最值得他關注、可發揮成貼文的文章。" +
    "嚴格遵守區塊定位與全域排除規則。同一事件（不同來源）只選一則；若是某持續事件的「新進展」可收錄並聚焦增量。" +
    "寧缺勿濫：找不到夠好的內容就少選，並說明原因。";

  const user = `# 本區塊：${tier.emoji} ${tier.label}
定位與切角：${tier.scope}
本區名額：${tier.count} 則

# 全域排除規則（命中則不選）
${cfg.globalExclusions.map((e) => `- ${e}`).join("\n")}

${rulesPrompt(tier, cfg)}

# 興趣輪廓（節錄，用於判斷相關性）
${interestProfile.slice(0, 1500)}

# 近 30 天已發過的標題（避免重複，同事件除非有新進展）
${recentTitles.length ? recentTitles.slice(0, 50).map((t) => `- ${t}`).join("\n") : "（無）"}

# 候選新聞（共 ${candidates.length} 則）
${list}

請依重要性排序，列出最多 ${tier.count + SPARE} 則值得收錄的候選（前 ${tier.count} 則是首選，其餘是配額超標時的備選）。
每則回傳 url（必須是候選清單中的原始 url）、title、一句挑選理由、tags。
shortfallNote：若夠格的候選少於 ${tier.count} 則，用 30 字內一句話說明原因（例如「窗口內沒有跨國飲料大廠的新消息」）；足額則留空字串。`;

  const result = await generateJSON<SelectResult>({
    model: MODELS.select,
    system,
    user,
    schema: selectSchema(tier, cfg),
    maxTokens: 6000,
  });

  // Map chosen urls back to the original hits; dedupe; cap the pool.
  const byUrl = new Map(candidates.map((c) => [c.url, c]));
  const ranked: SearchHit[] = [];
  const seen = new Set<string>();
  for (const s of result.selected) {
    const hit = byUrl.get(s.url);
    if (hit && !seen.has(hit.url)) {
      seen.add(hit.url);
      ranked.push({ ...hit, tags: s.tags ?? [] });
    }
    if (ranked.length >= tier.count + SPARE) break;
  }
  return { ranked, shortfallNote: result.shortfallNote ?? "" };
}
