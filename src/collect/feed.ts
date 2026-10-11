import { XMLParser } from "fast-xml-parser";
import { canonicalUrl, decodeEntities, htmlToText, stripPublisherSuffix } from "./text";

// RSS 2.0 / Atom / RSS 1.0 (RDF) → flat entries. Namespace prefixes are
// stripped (HBR serves Atom as `ns6:entry`), so one code path covers all three.

export interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  publishedAt: Date | null;
  publisher?: string; // Google News <source>
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  textNodeName: "#text",
  processEntities: false, // decoded by hand: feeds double-encode often
  parseTagValue: false,
  trimValues: true,
});

type Node = Record<string, unknown> | string | undefined;

const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function text(n: Node | Node[]): string {
  if (Array.isArray(n)) return text(n[0]);
  if (n == null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  const t = (n as Record<string, unknown>)["#text"];
  return t == null ? "" : String(t);
}

function atomLink(n: unknown): string {
  const links = asArray(n as Record<string, unknown> | Record<string, unknown>[]);
  const alt =
    links.find((l) => typeof l === "object" && (l["@rel"] == null || l["@rel"] === "alternate")) ?? links[0];
  if (!alt) return "";
  if (typeof alt === "string") return alt;
  return String(alt["@href"] ?? text(alt as Node));
}

function date(...candidates: Node[]): Date | null {
  for (const c of candidates) {
    const s = text(c).trim();
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Absolute URL, resolving relative item links (HBR) against the site link. */
function absolute(link: string, base: string | undefined): string {
  if (/^https?:\/\//i.test(link) || !base) return link;
  try {
    return new URL(link, base).toString();
  } catch {
    return link;
  }
}

export function parseFeed(xml: string, feedUrl?: string): FeedEntry[] {
  const doc = parser.parse(xml) as Record<string, Record<string, unknown>>;
  const rss = doc.rss?.channel as Record<string, unknown> | undefined;
  const items: Record<string, unknown>[] = [
    ...asArray(rss?.item as Record<string, unknown>[]),
    ...asArray(doc.RDF?.item as Record<string, unknown>[]), // RSS 1.0
    ...asArray(doc.feed?.entry as Record<string, unknown>[]), // Atom
  ];
  const siteLink = doc.feed ? atomLink(doc.feed.link) : text(rss?.link as Node);
  const base = /^https?:\/\//i.test(siteLink) ? siteLink : feedUrl;

  const out: FeedEntry[] = [];
  for (const it of items) {
    const rawLink = typeof it.link === "object" || Array.isArray(it.link) ? atomLink(it.link) : text(it.link as Node);
    const link = absolute(rawLink || text(it.guid as Node), base);
    const publisher = it.source ? decodeEntities(text(it.source as Node)).trim() || undefined : undefined;
    const title = stripPublisherSuffix(htmlToText(text(it.title as Node)), publisher);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const summary = htmlToText(
      text((it.description ?? it.summary ?? it.content ?? it.encoded) as Node),
    ).slice(0, 1000);
    out.push({
      title,
      link: canonicalUrl(decodeEntities(link)),
      summary,
      publishedAt: date(it.pubDate as Node, it.published as Node, it.updated as Node, it.date as Node),
      publisher,
    });
  }
  return out;
}
