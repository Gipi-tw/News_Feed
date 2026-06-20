// Shared types for the digest pipeline and config.

export type TierKey = "corp" | "ai_work" | "tier2" | "life";

export interface TierConfig {
  key: TierKey;
  emoji: string;
  label: string;
  subtitle: string;
  count: number;
  tierClass: string; // tier0..tier3 (maps to template CSS)
  scope: string;
  queries: string[];
}

export interface DigestConfig {
  timezone: string;
  scheduleCron: string;
  search: {
    // "claude" = Claude's built-in web_search tool (no key, but heavy input).
    // "ddg" = key-free DuckDuckGo HTML snippets (cheap input, snippet-first path).
    // "google" = Google Custom Search snippets (datacenter-friendly, free 100/day).
    provider: "claude" | "google" | "ddg" | "brave" | "serper" | "mock";
    fallbackProvider?: "google" | "ddg" | "brave" | "serper" | "mock";
    freshnessHours: number;
    resultsPerQuery: number;
    languages: string[];
  };
  dedup: { windowDays: number };
  comment: {
    minChars: number;
    maxChars: number;
    lifeMinChars: number;
    lifeMaxChars: number;
    maxRetries: number;
  };
  tiers: TierConfig[];
  globalExclusions: string[];
}

// A raw search hit before selection.
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  sourceName?: string;
  publishedDate?: string; // ISO or human string from the provider
  query?: string;
  tier?: TierKey;
}

// A candidate with optional fetched full text.
export interface Candidate extends SearchHit {
  fullText?: string;
}

// One selected, summarized article (pre-comment).
export interface SelectedArticle {
  tier: TierKey;
  title: string;
  sourceName: string;
  sourceDate: string;
  factSummary: string;
  opinionHook: string;
  urls: string[];
}

// Full article including the generated comment + lint result.
export interface BuiltArticle extends SelectedArticle {
  position: number;
  myComment: string;
  lintReport: LintReport;
}

export interface LintReport {
  ok: boolean;
  charCount: number;
  checks: { id: string; label: string; pass: boolean; detail?: string }[];
}

export interface DedupRecord {
  date: string;
  title: string;
  url: string;
  allUrls: string[];
  tier?: string;
}
