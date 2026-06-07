import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropicKey } from "./env";

// Model roles per SPEC §6: Sonnet-class for selection/summary, strongest model
// (Opus 4.8) for the voice-mimicking comment.
export const MODELS = {
  select: "claude-sonnet-4-6",
  summarize: "claude-sonnet-4-6",
  dedup: "claude-sonnet-4-6",
  comment: "claude-opus-4-8",
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
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
