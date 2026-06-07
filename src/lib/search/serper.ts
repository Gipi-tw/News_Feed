import { env } from "../env";
import type { SearchHit } from "../types";
import type { SearchOptions, SearchProvider } from "./provider";

// Serper.dev — Google SERP API. Fallback for Chinese-language coverage.
const ENDPOINT = "https://google.serper.dev/search";

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  source?: string;
}

export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  get available(): boolean {
    return Boolean(env.serperKey);
  }

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    // tbs=qdr:d (past day) / qdr:w (past week) — closest Google-supported window.
    const tbs = opts.freshnessHours <= 24 ? "qdr:d" : "qdr:w";
    const isZh = opts.lang !== "en";
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "X-API-KEY": env.serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        q: query,
        num: opts.count,
        tbs,
        gl: isZh ? "tw" : "us",
        hl: isZh ? "zh-tw" : "en",
      }),
    });
    if (!res.ok) {
      throw new Error(`Serper search failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { organic?: SerperOrganic[] };
    return (data.organic ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      sourceName: r.source ?? undefined,
      publishedDate: r.date ?? undefined,
      query,
    }));
  }
}
