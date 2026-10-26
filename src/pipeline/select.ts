import { MODELS, generateJSON } from "../lib/anthropic";
import type { DigestConfig, SearchHit, TierConfig } from "../lib/types";
import { rulesPrompt, tagsSchema } from "./rules-prompt";

// Stage 1: rank the best candidates for a tier from the search hits and tag
// each with topic tags. Returns a pool a few items longer than the tier's
// count so quota enforcement (quota.ts) can backfill after trimming.
// Snippet-based (full text is fetched only for the winners), so the prompt
// stays small even with many candidates.
//
// Picks come back as candidate numbers, not URLs: copying long URLs (Google
// News redirects, percent-encoded Chinese paths) is error-prone, and on 10/22
// every life-tier pick failed to match its candidate, shipping that tier empty.

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
            id: { type: "integer" },
            title: { type: "string" },
            reason: { type: "string" },
            tags: tagsSchema(tier, cfg),
          },
          required: ["id", "title", "reason", "tags"],
        },
      },
      shortfallNote: { type: "string" },
    },
    required: ["selected", "shortfallNote"],
  };
}

interface SelectResult {
  selected: { id: number; title: string; reason: string; tags: string[] }[];
  shortfallNote: string;
}

export interface TierSelection {
  ranked: SearchHit[]; // best first, each with tags
  shortfallNote: string;
  returned: number; // picks the model returned, before mapping (for the run log)
  attempts: number;
}

/** Tags that are kinds of AI story, so a tier's "AI ≤ n" cap covers them too. */
const IMPLIES_AI = ["ai_dev", "ai_strategy"];

/**
 * Model picks → candidates, best first: unknown or repeated numbers are
 * skipped, and AI-dev / AI-strategy pieces also count as AI (on 10/22 two
 * ai_dev-only picks slipped past 第二級's AI cap).
 */
export function mapSelection(
  candidates: SearchHit[],
  selected: { id: number; tags?: string[] }[],
  limit: number,
): SearchHit[] {
  const ranked: SearchHit[] = [];
  const seen = new Set<number>();
  for (const s of selected) {
    const hit = Number.isInteger(s.id) ? candidates[s.id] : undefined;
    if (!hit || seen.has(s.id)) continue;
    seen.add(s.id);
    const tags = new Set(s.tags ?? []);
    if (IMPLIES_AI.some((t) => tags.has(t))) tags.add("ai");
    ranked.push({ ...hit, tags: [...tags] });
    if (ranked.length >= limit) break;
  }
  return ranked;
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
  if (candidates.length === 0) return { ranked: [], shortfallNote: "今日沒有候選", returned: 0, attempts: 0 };

  const list = candidates
    .map(
      (c, i) =>
        `[${i}] ${c.title}\n    來源：${c.sourceName ?? "?"}｜日期：${c.publishedDate ?? "?"}｜${c.url}\n    摘要：${(c.snippet ?? "").slice(0, 300)}`,
    )
    .join("\n");

  // Everything shared by the five tier calls of one run goes in the system
  // prompt (cached); only the tier and its candidates vary per call.
  const system = `你是游舒帆（Gipi）的個人內容策展編輯。今天是 ${today}（台北時間）。你的任務是依他的興趣輪廓，從候選新聞中挑出最值得他關注、可發揮成貼文的文章。
嚴格遵守區塊定位與全域排除規則。同一事件（不同來源）只選一則；若是某持續事件的「新進展」可收錄並聚焦增量。
寧缺勿濫：找不到夠好的內容就少選，並說明原因。

# 全域排除規則（命中則不選）
${cfg.globalExclusions.map((e) => `- ${e}`).join("\n")}

# 近 30 天已發過的標題（避免重複，同事件除非有新進展）
${recentTitles.length ? recentTitles.slice(0, 50).map((t) => `- ${t}`).join("\n") : "（無）"}

# 興趣輪廓（全文）
${interestProfile}`;

  const user = `# 本區塊：${tier.emoji} ${tier.label}
定位與切角：${tier.scope}
本區名額：${tier.count} 則

${rulesPrompt(tier, cfg)}

# 候選新聞（共 ${candidates.length} 則）
${list}

請依重要性排序，列出最多 ${tier.count + SPARE} 則值得收錄的候選（前 ${tier.count} 則是首選，其餘是配額超標時的備選）。
每則回傳 id（候選清單開頭的編號，例如 [3] 就填 3）、title、一句挑選理由、tags。
shortfallNote：若夠格的候選少於 ${tier.count} 則，用 30 字內一句話說明原因（例如「窗口內沒有跨國飲料大廠的新消息」）；足額則留空字串。`;

  // A tier that comes back with nothing usable gets one more try.
  let result: SelectResult = { selected: [], shortfallNote: "" };
  let ranked: SearchHit[] = [];
  let attempts = 0;
  while (attempts < 2 && !ranked.length) {
    attempts++;
    result = await generateJSON<SelectResult>({
      model: MODELS.select,
      system,
      user,
      schema: selectSchema(tier, cfg),
      maxTokens: 16000, // Haiku 5.5 thinking counts toward this
      cacheSystem: true,
    });
    ranked = mapSelection(candidates, result.selected, tier.count + SPARE);
  }
  return { ranked, shortfallNote: result.shortfallNote ?? "", returned: result.selected.length, attempts };
}
