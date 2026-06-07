import { env } from "../env";
import type { SearchHit } from "../types";
import { type SearchOptions, type SearchProvider, freshnessRange } from "./provider";

// Brave Search API — https://api.search.brave.com/res/v1/web/search
const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
  age?: string;
  profile?: { name?: string };
  meta_url?: { hostname?: string };
}

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  get available(): boolean {
    return Boolean(env.braveKey);
  }

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const { from, to } = freshnessRange(opts.freshnessHours);
    const params = new URLSearchParams({
      q: query,
      count: String(opts.count),
      freshness: `${from}to${to}`,
      // Brave: search_lang biases language; zh-hant / en
      search_lang: opts.lang === "en" ? "en" : "zh-hant",
      text_decorations: "false",
      spellcheck: "false",
    });
    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": env.braveKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Brave search failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { web?: { results?: BraveResult[] } };
    const results = data.web?.results ?? [];
    return results.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
      sourceName: r.profile?.name ?? r.meta_url?.hostname ?? undefined,
      publishedDate: r.page_age ?? r.age ?? undefined,
      query,
    }));
  }
}
