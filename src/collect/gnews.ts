import type { GoogleNewsQuery } from "../lib/types";

// Google News RSS: a free, keyless news search that works from datacenter IPs
// (verified from the Fly nrt machine, 2026-10-10). Item links are
// news.google.com redirects; `decodeGoogleNewsUrl` resolves the original URL
// via the same two calls the Google News web app makes (article page →
// signature + timestamp → batchexecute). Only done for items we actually pick.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export function googleNewsSearchUrl(q: Pick<GoogleNewsQuery, "query" | "lang">, window = "2d"): string {
  const query = encodeURIComponent(`${q.query} when:${window}`);
  return q.lang === "zh-TW"
    ? `https://news.google.com/rss/search?q=${query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
    : `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

export function isGoogleNewsLink(url: string): boolean {
  return /^https:\/\/news\.google\.com\/(rss\/)?articles\//.test(url);
}

export function googleNewsArticleId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "news.google.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("articles");
    return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
  } catch {
    return null;
  }
}

async function fetchText(url: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.text() };
}

/** Original article URL for a Google News link, or null if it can't be resolved. */
export async function decodeGoogleNewsUrl(link: string): Promise<string | null> {
  const id = googleNewsArticleId(link);
  if (!id) return null;
  try {
    const page = await fetchText(`https://news.google.com/rss/articles/${id}`);
    const sg = page.body.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = page.body.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify([
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id,
      Number(ts),
      sg,
    ]);
    const res = await fetchText("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]])),
    });
    const chunk = res.body.split("\n\n")[1];
    const url = JSON.parse(JSON.parse(chunk)[0][2])[1];
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}
