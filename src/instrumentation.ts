// Next.js server start hook: runs once per server process. Starts the daily
// digest scheduler in production only (never in `next dev`, so a local server
// can't spend API credit by itself). DIGEST_SCHEDULER=off disables it.
//
// The import must sit inside `if (NEXT_RUNTIME === "nodejs")` (not after an
// early return) so the Edge build can drop it — the pipeline pulls in
// Node-only modules (jsdom, https).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production" && process.env.DIGEST_SCHEDULER !== "off") {
      const { startScheduler } = await import("./lib/scheduler");
      startScheduler();
    }
  }
}
