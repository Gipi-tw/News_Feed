import type { SearchHit } from "../types";

export interface SearchOptions {
  freshnessHours: number;
  count: number;
  lang?: string; // e.g. "zh-hant" | "en"
}

// Pluggable search interface (SPEC §6 — provider must be swappable).
export interface SearchProvider {
  readonly name: string;
  /** True when the provider has the credentials it needs. */
  readonly available: boolean;
  search(query: string, opts: SearchOptions): Promise<SearchHit[]>;
}

// Helper: a date range string for "the last N hours", as YYYY-MM-DD..YYYY-MM-DD.
export function freshnessRange(hours: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}
