// Shared types for the digest pipeline and config.

// "ai_work" is the pre-2026-10 tier (replaced by "leadership"); kept so old
// digests still render.
export type TierKey = "corp" | "food" | "leadership" | "tier2" | "life" | "ai_work";

// A hard quota on a topic tag (SPEC: AI 比例上限 etc.). The selector tags each
// pick; the pipeline then enforces min/max deterministically, so feedback or a
// chatty model can never push past them.
export interface TagRule {
  tag: string;
  desc: string;
  max?: number;
  min?: number;
}

export interface TierConfig {
  key: TierKey;
  emoji: string;
  label: string;
  subtitle: string;
  count: number;
  tierClass: string; // tier0..tier4 (maps to template CSS)
  scope: string;
  queries: string[];
  rules?: TagRule[];
}

export interface DigestConfig {
  // Bumped when the bundled config changes shape/meaning; a DB copy with a
  // lower version is replaced on read (see lib/config.ts).
  configVersion?: number;
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
    // Claude web_search mode only: max searches per tier per run.
    maxSearchesPerTier?: number;
  };
  dedup: { windowDays: number };
  comment: {
    minChars: number;
    maxChars: number;
    lifeMinChars: number;
    lifeMaxChars: number;
    maxRetries: number;
  };
  // Quotas across the whole digest (e.g. AI-centric ≤ 15).
  globalRules?: TagRule[];
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
  tags?: string[];
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
  tags: string[];
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
