import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { Candidate, SearchHit } from "../lib/types";

// Best-effort full-text extraction. Falls back to the search snippet when the
// URL isn't fetchable (mock URLs, paywalls, timeouts) so the pipeline never
// stalls on a single bad source.
async function fetchFullText(url: string): Promise<string | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; gipi-digest/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) return undefined;
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent?.trim();
    if (!text) return undefined;
    // Cap to keep token usage sane.
    return text.length > 8000 ? text.slice(0, 8000) : text;
  } catch {
    return undefined;
  }
}

export async function enrichCandidates(hits: SearchHit[]): Promise<Candidate[]> {
  // Fetch with bounded concurrency.
  const out: Candidate[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < hits.length; i += CONCURRENCY) {
    const batch = hits.slice(i, i + CONCURRENCY);
    const texts = await Promise.all(batch.map((h) => fetchFullText(h.url)));
    batch.forEach((h, j) => {
      out.push({ ...h, fullText: texts[j] ?? h.snippet });
    });
  }
  return out;
}
