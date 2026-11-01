import { MODELS, generateJSON } from "../lib/anthropic";

// Same-event check over the whole issue. Each tier's selector only sees its own
// candidates, and even within a tier it sometimes keeps two outlets' reports of
// one story (10/21: "Atlanta council backs Starbucks boycott" from 11Alive and
// Atlanta Intown, both in 餐飲). One cheap call over every ranked pick + spare
// finds groups covering the same event; the best-ranked one stays, and quota
// enforcement backfills from the spares.
//
// The same call also checks the picks against what ran in the last few days.
// The selector is shown recent titles, but they're the published Chinese
// titles and the candidates are English, so it kept missing them: 11/1
// re-ran 10/31's Starbucks drive-thru menu, Starbucks multi-brand (the same
// Bloomberg piece) and KFC Muse, and Gipi read none of them. A pick that
// re-reports a published event goes, unless the event itself moved on.

export const REPEAT_DAYS = 3; // every repeat seen 10/27–11/1 was 1–2 days later

export interface EventItem {
  title: string;
  sourceName?: string | null;
  snippet?: string | null;
}

export interface PublishedItem extends EventItem {
  date: string; // YYYY-MM-DD
}

export interface SameEventResult {
  groups: { event: string; ids: number[] }[]; // picks reporting the same event
  repeats: { event: string; id: number; published: number }[]; // picks re-reporting a published event
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
    repeats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { event: { type: "string" }, id: { type: "integer" }, published: { type: "integer" } },
        required: ["event", "id", "published"],
      },
    },
  },
  required: ["groups", "repeats"],
};

const line = (it: EventItem) =>
  `${it.title}｜${it.sourceName ?? "?"}｜${(it.snippet ?? "").replace(/\s+/g, " ").slice(0, 160)}`;

/** The model request (split out for tests). */
export function sameEventPrompt(items: EventItem[], published: PublishedItem[]): { system: string; user: string } {
  const system =
    "你是新聞編輯，負責檢查一份日報的候選清單有沒有重複報導。" +
    "「報導同一件事」指同一個決議、公告、財報、研究、產品發表、人事異動、官司或事故，只是來源、語言或角度不同。" +
    "同一家公司或同一主題的不同事件不算重複。\n" +
    "groups：今天候選之間的重複。只回傳有 2 則以上的群組，event 用 15 字內描述事件。\n" +
    "repeats：今天候選中，跟「最近幾天已刊出」是同一則新聞的（讀者已經看過）：同一個公告、發表、決議、財報、交易、人事或事故，" +
    "只是換了來源、語言或標題，內容大致相同；補一些細節或股價反應也還是同一則。" +
    "不算重複：(1) 事件本身往前走了一步，例如提案後正式核准或否決、測試後正式上線、事故後公布調查結果、當事人做出新的決定或回應；" +
    "(2) 同一家公司、同一個人或同一主題的另一篇分析、專訪、評論或深度報導，主軸跟已刊出的不同。拿不準就不要列。" +
    "id 填今天候選的編號，published 填已刊出的編號數字（[P3] 就填 3），event 用 15 字內描述事件。\n" +
    "沒有就回空陣列。";
  const user = [
    published.length
      ? `# 最近幾天已刊出（共 ${published.length} 則，格式：[P編號] 日期｜標題｜來源｜摘要）\n` +
        published.map((p, i) => `[P${i}] ${p.date.slice(5)}｜${line(p)}`).join("\n")
      : "",
    `# 今天候選（共 ${items.length} 則，格式：[編號] 標題｜來源｜摘要）\n` + items.map((it, i) => `[${i}] ${line(it)}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

/** Drop groups and repeats that don't point at real items. */
export function cleanSameEvent(res: SameEventResult, items: number, published: number): SameEventResult {
  const ok = (i: number, n: number) => Number.isInteger(i) && i >= 0 && i < n;
  return {
    groups: res.groups.filter((g) => new Set(g.ids.filter((i) => ok(i, items))).size >= 2),
    repeats: res.repeats.filter((r) => ok(r.id, items) && ok(r.published, published)),
  };
}

/** Same-event groups among `items`, and items repeating something in `published`. */
export async function findSameEvent(items: EventItem[], published: PublishedItem[] = []): Promise<SameEventResult> {
  if (!items.length || (items.length < 2 && !published.length)) return { groups: [], repeats: [] };
  const res = await generateJSON<SameEventResult>({
    model: MODELS.dedup,
    ...sameEventPrompt(items, published),
    schema: SCHEMA,
    maxTokens: 8000,
    effort: "low",
  });
  return cleanSameEvent(res, items.length, published.length);
}

/**
 * Keep the best-ranked member of each group (lowest rank in its pool; ties go
 * to the earlier pool) and drop the rest, and drop every repeat. `groups` and
 * `repeats` index into the pools flattened in order. Returns how many items
 * each pool lost to each (an item that is both counts as a repeat).
 */
export function dropSameEvent<T>(
  pools: { ranked: T[] }[],
  groups: { ids: number[] }[],
  repeats: number[] = [],
): { sameEvent: number[]; repeated: number[] } {
  const at: { pool: number; rank: number }[] = [];
  pools.forEach((p, pool) => p.ranked.forEach((_, rank) => at.push({ pool, rank })));
  const drop = pools.map(() => new Set<number>());
  const repeated = pools.map(() => new Set<number>());
  for (const g of groups) {
    const members = [...new Set(g.ids)].filter((i) => i >= 0 && i < at.length).map((i) => at[i]);
    if (members.length < 2) continue;
    members.sort((a, b) => a.rank - b.rank || a.pool - b.pool);
    for (const m of members.slice(1)) drop[m.pool].add(m.rank);
  }
  for (const i of repeats) {
    if (i < 0 || i >= at.length) continue;
    drop[at[i].pool].add(at[i].rank);
    repeated[at[i].pool].add(at[i].rank);
  }
  pools.forEach((p, i) => {
    p.ranked = p.ranked.filter((_, rank) => !drop[i].has(rank));
  });
  return { sameEvent: drop.map((d, i) => d.size - repeated[i].size), repeated: repeated.map((r) => r.size) };
}
