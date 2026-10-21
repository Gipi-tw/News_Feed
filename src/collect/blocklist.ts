// Publishers that never become candidates: aggregators and re-posters that
// Google News surfaces (MSN, 蕃新聞), and sources Gipi excluded (36Kr).
// Every entry matches the publisher name exactly, ignoring case — so "MSN"
// blocks MSN but not MSNBC. An entry with a dot also matches the URL's host
// and its subdomains; Google News names some publishers by domain ("AOL.com"),
// so one entry covers both before and after the link is decoded.

export type PublisherBlocker = (sourceName: string | null | undefined, url?: string | null) => boolean;

export function publisherBlocker(list: string[] = []): PublisherBlocker {
  const entries = list.map((x) => x.trim().toLowerCase()).filter(Boolean);
  const names = new Set(entries);
  const hosts = entries.filter((x) => x.includes("."));
  return (sourceName, url) => {
    if (sourceName && names.has(sourceName.trim().toLowerCase())) return true;
    if (!url || !hosts.length) return false;
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  };
}
