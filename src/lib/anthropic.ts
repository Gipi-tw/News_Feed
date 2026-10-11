import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropicKey } from "./env";

// Cost-optimized model roles: the digest is a pure curation list (no
// voice-mimicking comment), so every stage runs on Haiku. Haiku 5.5 is ~10×
// cheaper than 4.5 and better at instruction following; the Claude web_search
// research mode stays on 4.5, the only Haiku it was verified with (2026-06-20).
export const MODELS = {
  score: "claude-haiku-5-5",
  select: "claude-haiku-5-5",
  summarize: "claude-haiku-5-5",
  research: "claude-haiku-4-5-20251001",
  dedup: "claude-haiku-5-5",
  comment: "claude-haiku-5-5",
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
  costUSD: number;
}

// Per-million-token USD prices + web_search per-call fee. Keep in sync with
// the Anthropic pricing page; used only for the logged estimate. Haiku 5.5's
// rate doubles for prompts over 100K tokens — ours stay well under.
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};
const WEB_SEARCH_PER_CALL = 0.01; // $10 / 1k searches

function priceFor(model: string) {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  return PRICES[key ?? "claude-haiku-4-5"];
}

export const usage: UsageTotals = newUsage();

export function newUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearches: 0,
    calls: 0,
    costUSD: 0,
  };
}

export function resetUsage(): void {
  Object.assign(usage, newUsage());
}

/** Fold one API response's usage block into the running totals. */
export function recordUsage(u: unknown, model: string): void {
  if (!u || typeof u !== "object") return;
  const x = u as Record<string, unknown>;
  const p = priceFor(model);
  const input = num(x.input_tokens);
  const output = num(x.output_tokens);
  const cacheWrite = num(x.cache_creation_input_tokens);
  const cacheRead = num(x.cache_read_input_tokens);
  const su = x.server_tool_use as Record<string, unknown> | undefined;
  const searches = su ? num(su.web_search_requests) : 0;
  usage.calls += 1;
  usage.inputTokens += input;
  usage.outputTokens += output;
  usage.cacheCreationInputTokens += cacheWrite;
  usage.cacheReadInputTokens += cacheRead;
  usage.webSearches += searches;
  usage.costUSD +=
    (input * p.input + output * p.output + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / 1_000_000 +
    searches * WEB_SEARCH_PER_CALL;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Estimated USD cost of the accumulated usage. */
export function estimateCostUSD(u: UsageTotals = usage): number {
  return u.costUSD;
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
  // Haiku 5.5 thinks adaptively by default (effort "medium"); "low" for bulk
  // classification. Thinking counts toward maxTokens, so keep it roomy.
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const res = await client().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 16000,
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  recordUsage(res.usage, opts.model);
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`No JSON in response (stop_reason: ${res.stop_reason})`);
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
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const msg = await stream.finalMessage();
  recordUsage(msg.usage, opts.model);
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
