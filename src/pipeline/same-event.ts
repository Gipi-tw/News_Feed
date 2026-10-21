import { MODELS, generateJSON } from "../lib/anthropic";

// Same-event check over the whole issue. Each tier's selector only sees its own
// candidates, and even within a tier it sometimes keeps two outlets' reports of
// one story (10/21: "Atlanta council backs Starbucks boycott" from 11Alive and
// Atlanta Intown, both in 餐飲). One cheap call over every ranked pick + spare
// finds groups covering the same event; the best-ranked one stays, and quota
// enforcement backfills from the spares.

export interface EventItem {
  title: string;
  sourceName?: string | null;
  snippet?: string | null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { event: { type: "string" }, ids: { type: "array", items: { type: "integer" } } },
        required: ["event", "ids"],
      },
    },
  },
  required: ["groups"],
};

/** Groups (≥ 2 indexes into `items`) of items reporting the same event. */
export async function findSameEvent(items: EventItem[]): Promise<{ event: string; ids: number[] }[]> {
  if (items.length < 2) return [];
  const list = items
    .map((it, i) => `[${i}] ${it.title}｜${it.sourceName ?? "?"}｜${(it.snippet ?? "").replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n");
  const res = await generateJSON<{ groups: { event: string; ids: number[] }[] }>({
    model: MODELS.dedup,
    system:
      "你是新聞編輯，負責檢查一份日報的候選清單有沒有重複報導。" +
      "找出「報導同一件事」的候選：同一個決議、公告、財報、研究、人事異動、官司或事故，只是來源、語言或角度不同。" +
      "同一家公司或同一主題的不同事件不算重複。只回傳有 2 則以上的群組，event 用 15 字內描述事件；沒有重複就回空陣列。",
    user: `# 候選（共 ${items.length} 則，格式：[編號] 標題｜來源｜摘要）\n${list}`,
    schema: SCHEMA,
    maxTokens: 8000,
    effort: "low",
  });
  return res.groups.filter((g) => new Set(g.ids.filter((i) => i >= 0 && i < items.length)).size >= 2);
}

/**
 * Keep the best-ranked member of each group (lowest rank in its pool; ties go
 * to the earlier pool) and drop the rest. `groups` index into the pools
 * flattened in order. Returns how many items each pool lost.
 */
export function dropSameEvent<T>(pools: { ranked: T[] }[], groups: { ids: number[] }[]): number[] {
  const at: { pool: number; rank: number }[] = [];
  pools.forEach((p, pool) => p.ranked.forEach((_, rank) => at.push({ pool, rank })));
  const drop = pools.map(() => new Set<number>());
  for (const g of groups) {
    const members = [...new Set(g.ids)].filter((i) => i >= 0 && i < at.length).map((i) => at[i]);
    if (members.length < 2) continue;
    members.sort((a, b) => a.rank - b.rank || a.pool - b.pool);
    for (const m of members.slice(1)) drop[m.pool].add(m.rank);
  }
  pools.forEach((p, i) => {
    p.ranked = p.ranked.filter((_, rank) => !drop[i].has(rank));
  });
  return drop.map((d) => d.size);
}
