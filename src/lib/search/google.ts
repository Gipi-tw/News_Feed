import { env } from "../env";
import type { SearchHit } from "../types";
import type { SearchOptions, SearchProvider } from "./provider";

// Google Programmable Search (Custom Search JSON API) — a snippet source that
// works from datacenter IPs (unlike free scraping) and is free up to 100
// queries/day. Returns title/snippet/link, which keeps the two-stage
// select→summarize pipeline's input small. Needs two free credentials:
//   GOOGLE_CSE_KEY  — a Google Cloud API key with "Custom Search API" enabled
//   GOOGLE_CSE_ID   — the Programmable Search Engine id (cx), set to "search the entire web"
const ENDPOINT = "https://www.googleapis.com/customsearch/v1";

interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
  pagemap?: { metatags?: Array<Record<string, string>> };
}

function publishedFrom(item: CseItem): string | undefined {
  const m = item.pagemap?.metatags?.[0];
  return (
    m?.["article:published_time"] ??
    m?.["og:updated_time"] ??
    m?.["date"] ??
    undefined
  );
}

export class GoogleCseProvider implements SearchProvider {
  readonly name = "google";
  get available(): boolean {
    return Boolean(env.googleCseKey && env.googleCseId);
  }

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const isZh = opts.lang !== "en";
    // dateRestrict buckets: dN (days) / wN (weeks). Closest to freshnessHours.
    const dateRestrict =
      opts.freshnessHours <= 24
        ? "d1"
        : opts.freshnessHours <= 48
          ? "d2"
          : opts.freshnessHours <= 168
            ? "w1"
            : "m1";
    const params = new URLSearchParams({
      key: env.googleCseKey,
      cx: env.googleCseId,
      q: query,
      num: String(Math.min(opts.count, 10)), // CSE hard-caps at 10/request
      dateRestrict,
      lr: isZh ? "lang_zh-TW" : "lang_en",
      gl: isZh ? "tw" : "us",
      safe: "off",
    });

    const res = await fetch(`${ENDPOINT}?${params}`);
    if (!res.ok) {
      throw new Error(`Google CSE failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { items?: CseItem[] };
    return (data.items ?? []).map((it) => ({
      title: it.title ?? "",
      url: it.link ?? "",
      snippet: it.snippet ?? "",
      sourceName: it.displayLink ?? undefined,
      publishedDate: publishedFrom(it),
      query,
    }));
  }
}
