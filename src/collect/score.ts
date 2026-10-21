import { MODELS, generateJSON } from "../lib/anthropic";
import type { DigestConfig } from "../lib/types";

// Second-pass filter: Haiku reads only title + summary of each prefiltered
// item and assigns the best tier (or "none") with a 0–10 relevance score.
// Full text is fetched later, and only for the items a digest actually picks.

export interface ScoreInput {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  hints: string[];
}

export interface ScoreOutput {
  id: string;
  tier: string; // a tier key or "none"
  score: number;
}

const BATCH = 50;
const CONCURRENCY = 3;

export async function scoreItems(
  items: ScoreInput[],
  cfg: DigestConfig,
  interestProfile: string,
): Promise<{ results: ScoreOutput[]; failedBatches: number; lastError?: string }> {
  const tierKeys = cfg.tiers.map((t) => t.key);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            i: { type: "integer" },
            tier: { type: "string", enum: [...tierKeys, "none"] },
            score: { type: "integer" },
          },
          required: ["i", "tier", "score"],
        },
      },
    },
    required: ["results"],
  };

  // Stable across batches (no dates, no per-batch data) so it caches.
  const system = `你是游舒帆（Gipi）的新聞初篩員。對每則候選，判斷它最適合放進日報的哪一區，並給 0–10 分：Gipi 今天會不會想看、值不值得收進日報。
- 9–10：正中區塊定位、有具體數據或重要新進展
- 6–8：符合定位、有價值
- 3–5：沾邊但普通
- 0–2：不相關、廣告、產品促銷、純財報股價、徵才頁、作者頁、登入頁
不屬於任何區塊、或命中排除規則，tier 填 "none"、分數給 0–2。

# 區塊
${cfg.tiers.map((t) => `- ${t.key}｜${t.emoji} ${t.label}：${t.scope}`).join("\n")}

# 全域排除
${cfg.globalExclusions.map((e) => `- ${e}`).join("\n")}

# 興趣輪廓（節錄）
${interestProfile.slice(0, 1500)}`;

  const batches: ScoreInput[][] = [];
  for (let start = 0; start < items.length; start += BATCH) batches.push(items.slice(start, start + BATCH));

  const out: ScoreOutput[] = [];
  let failedBatches = 0;
  let lastError: string | undefined;
  const scoreBatch = async (batch: ScoreInput[]) => {
    const list = batch
      .map(
        (it, i) =>
          `[${i}] ${it.title}\n    來源：${it.sourceName}｜線索：${it.hints.join(",") || "—"}\n    ${it.summary.slice(0, 280)}`,
      )
      .join("\n");
    // A failed batch stays unscored and is retried on the next collection.
    let res: { results: { i: number; tier: string; score: number }[] };
    try {
      res = await generateJSON<{ results: { i: number; tier: string; score: number }[] }>({
        model: MODELS.score,
        system,
        user: `請為以下 ${batch.length} 則逐一評分（每則都要回，i 是編號）：\n\n${list}`,
        schema,
        maxTokens: 12000,
        effort: "low",
      });
    } catch (err) {
      failedBatches++;
      lastError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      console.error("[collect] scoring batch failed:", lastError);
      return;
    }
    for (const r of res.results) {
      const it = batch[r.i];
      if (!it) continue;
      out.push({ id: it.id, tier: r.tier, score: Math.max(0, Math.min(10, Math.round(r.score))) });
    }
  };
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(scoreBatch));
  }
  return { results: out, failedBatches, lastError };
}
