import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropicKey } from "./env";

// Cost-optimized model roles: the digest is now a pure curation list (no
// voice-mimicking comment), so every stage runs on Haiku 4.5. The `comment`
// role is kept only for the optional on-demand single-post path (not used by
// the daily run); it points at Haiku too so nothing silently bills Opus.
export const MODELS = {
  select: "claude-haiku-4-5-20251001",
  summarize: "claude-haiku-4-5-20251001",
  dedup: "claude-haiku-4-5-20251001",
  comment: "claude-haiku-4-5-20251001",
} as const;

let _client: Anthropic | null = null;
export function client(): Anthropic {
  if (!_client) {
    // maxRetries: the SDK backs off on 429/5xx honoring retry-after, which
    // smooths bursts against the org's per-minute input-token limit.
    _client = new Anthropic({ apiKey: requireAnthropicKey(), maxRetries: 6 });
  }
  return _client;
}

// ── Cost/usage tracking ("先量再砍") ───────────────────────────────────────
// Accumulates token + web_search counts across one pipeline run so we can log
// an estimated per-run cost and trim search caps from real data.

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearches: number;
  calls: number;
}

// Per-million-token USD prices (Haiku 4.5) + web_search per-call fee. Keep in
// sync with https://docs.claude.com pricing; used only for the logged estimate.
export const PRICING = {
  haiku: { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  webSearchPerCall: 0.01, // $10 / 1k searches
} as const;

export const usage: UsageTotals = newUsage();

export function newUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearches: 0,
    calls: 0,
  };
}

export function resetUsage(): void {
  Object.assign(usage, newUsage());
}

/** Fold one API response's usage block into the running totals. */
export function recordUsage(u: unknown): void {
  if (!u || typeof u !== "object") return;
  const x = u as Record<string, unknown>;
  usage.calls += 1;
  usage.inputTokens += num(x.input_tokens);
  usage.outputTokens += num(x.output_tokens);
  usage.cacheCreationInputTokens += num(x.cache_creation_input_tokens);
  usage.cacheReadInputTokens += num(x.cache_read_input_tokens);
  const su = x.server_tool_use as Record<string, unknown> | undefined;
  if (su) usage.webSearches += num(su.web_search_requests);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Estimated USD cost of the accumulated usage (Haiku pricing). */
export function estimateCostUSD(u: UsageTotals = usage): number {
  const p = PRICING.haiku;
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheCreationInputTokens * p.cacheWrite +
      u.cacheReadInputTokens * p.cacheRead) /
      1_000_000 +
    u.webSearches * PRICING.webSearchPerCall
  );
}

/**
 * Ask Claude for a value matching a JSON Schema and return the parsed object.
 * Uses structured outputs (output_config.format) so the first text block is
 * guaranteed valid JSON.
 */
export async function generateJSON<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const res = await client().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: opts.schema } },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  recordUsage(res.usage);
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("No text block in structured-output response");
  }
  return JSON.parse(text.text) as T;
}

/**
 * Generate long-form prose (the comment). Streams to avoid HTTP timeouts on
 * large outputs, then returns the full text.
 */
export async function generateText(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const stream = client().messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const msg = await stream.finalMessage();
  recordUsage(msg.usage);
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
