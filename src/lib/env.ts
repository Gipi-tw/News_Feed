// Centralized environment access. Throws loudly for required server-side keys
// only when they're actually used (so the site can boot for read-only browsing
// even before search keys are configured).

export const env = {
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  braveKey: process.env.BRAVE_API_KEY ?? "",
  serperKey: process.env.SERPER_API_KEY ?? "",
  searchProviderOverride: process.env.SEARCH_PROVIDER ?? "",
  authUsername: process.env.AUTH_USERNAME ?? "",
  authPasswordHash: process.env.AUTH_PASSWORD_HASH ?? "",
  authSecret: process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me",
  cronSecret: process.env.CRON_SECRET ?? "",
  notifyEmail: process.env.NOTIFY_EMAIL ?? "",
  resendKey: process.env.RESEND_API_KEY ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
};

export function requireAnthropicKey(): string {
  if (!env.anthropicKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The pipeline needs it to generate summaries and comments.",
    );
  }
  return env.anthropicKey;
}
