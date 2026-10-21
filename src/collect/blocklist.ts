// Publishers that never become candidates: aggregators and re-posters that
// Google News surfaces (MSN, 蕃新聞), and sources Gipi excluded (36Kr).
// An entry with a dot matches the URL's host and its subdomains; any other
// entry matches the publisher name exactly, ignoring case — so "MSN" blocks
// MSN but not MSNBC.

export type PublisherBlocker = (sourceName: string | null | undefined, url?: string | null) => boolean;

export function publisherBlocker(list: string[] = []): PublisherBlocker {
  const entries = list.map((x) => x.trim().toLowerCase()).filter(Boolean);
  const names = new Set(entries.filter((x) => !x.includes(".")));
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
