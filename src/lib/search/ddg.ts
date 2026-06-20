import { JSDOM } from "jsdom";
import type { SearchHit } from "../types";
import type { SearchOptions, SearchProvider } from "./provider";

// DuckDuckGo HTML endpoint — a key-free snippet source that replaces a paid
// search API (Brave/Serper). Returns title + snippet + url per result, which is
// exactly what the snippet-first two-stage pipeline needs (select → summarize)
// to keep LLM input tokens low. Unofficial + best-effort: on a block/anomaly
// page it simply returns [] and the pipeline carries on with what it has.
const ENDPOINT = "https://html.duckduckgo.com/html/";

// DDG wraps result links in a redirect: //duckduckgo.com/l/?uddg=<encoded url>.
function decodeHref(href: string): string {
  try {
    const u = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ?? u.toString();
  } catch {
    return href;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "ddg";
  readonly available = true; // no credentials required

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const isZh = opts.lang !== "en";
    // DDG only supports day/week/month freshness buckets.
    const df = opts.freshnessHours <= 24 ? "d" : opts.freshnessHours <= 168 ? "w" : "m";
    const body = new URLSearchParams({
      q: query,
      kl: isZh ? "tw-tzh" : "us-en",
      df,
    });

    // Be polite: small delay reduces the chance of rate-limit/anomaly pages
    // when firing ~20 sequential queries per run.
    await sleep(400);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let html: string;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        body: body.toString(),
      });
      if (!res.ok) {
        throw new Error(`DDG search failed (${res.status})`);
      }
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const doc = new JSDOM(html).window.document;
    const out: SearchHit[] = [];
    // Skip sponsored rows (.result--ad).
    doc.querySelectorAll(".result:not(.result--ad)").forEach((node) => {
      const a = node.querySelector("a.result__a");
      if (!a) return;
      const url = decodeHref(a.getAttribute("href") ?? "");
      if (!/^https?:\/\//i.test(url)) return;
      const title = (a.textContent ?? "").trim();
      const snippet = (node.querySelector(".result__snippet")?.textContent ?? "").trim();
      const sourceName =
        (node.querySelector(".result__url")?.textContent ?? "").trim().split("/")[0] || undefined;
      if (title) out.push({ title, url, snippet, sourceName, query });
    });
    return out.slice(0, opts.count);
  }
}
