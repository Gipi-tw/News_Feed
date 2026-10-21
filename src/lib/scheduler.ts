import { prisma } from "./db";
import { getDigestConfig } from "./config";
import { dueSlotStart, parseDailyCron } from "./schedule-time";
import { runDigest } from "../pipeline";
import { runCollect } from "../collect";

// In-process scheduler. The prod machine is always on (fly.toml
// auto_stop=off, min 1 machine), so it runs the jobs itself — on time, with no
// external cron. (GitHub Actions cron fired 60–80 minutes late in June, and
// public-repo schedules get auto-disabled after 60 days without commits.)
// Started from src/instrumentation.ts in production.
//
// Jobs (one at a time):
//   - digest: daily at digest_config.scheduleCron (08:00 Asia/Taipei)
//   - collect: daily at sources.collectCron (05:00 Asia/Taipei; RSS / Google News)

const TICK_MS = 60_000;
const GRACE_MINUTES = 4 * 60; // a restart within 4h after the slot still runs today
const DEFAULT_SLOT = 8 * 60;
const COLLECT_GRACE_MINUTES = 3 * 60; // a restart before 08:00 still collects

let started = false;
let busy = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  console.log("[scheduler] started");
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  void tick();
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    if (!(await digestIfDue())) await collectIfDue();
  } catch (err) {
    // Jobs record their own failures (RunLog / CollectRun); this catches setup errors.
    console.error("[scheduler] tick failed:", err);
  } finally {
    busy = false;
  }
}

/** Runs today's digest if its slot has come. Returns true if it ran. */
async function digestIfDue(): Promise<boolean> {
  const cfg = await getDigestConfig();
  const slot = parseDailyCron(cfg.scheduleCron) ?? DEFAULT_SLOT;
  const since = dueSlotStart(slot, GRACE_MINUTES, cfg.timezone);
  if (!since) return false;

  // One attempt per day: skip if a scheduled run already started since the
  // slot, or if any run since then is in progress / already succeeded (e.g.
  // a manual run at 08:05).
  const already = await prisma.runLog.findFirst({
    where: {
      startedAt: { gte: since },
      OR: [{ trigger: "cron" }, { status: { in: ["running", "success"] } }],
    },
  });
  if (already) return false;

  const run = await prisma.runLog.create({
    data: { trigger: "cron", status: "running", message: "排程觸發" },
  });
  console.log(`[scheduler] daily digest triggered (run ${run.id})`);
  await runDigest({ trigger: "cron", runId: run.id }).catch(() => {
    /* recorded in RunLog */
  });
  return true;
}

async function collectIfDue(): Promise<void> {
  const cfg = await getDigestConfig();
  const slot = cfg.sources?.collectCron ? parseDailyCron(cfg.sources.collectCron) : null;
  if (slot == null) return;
  const since = dueSlotStart(slot, COLLECT_GRACE_MINUTES, cfg.timezone);
  if (!since) return;
  // One attempt per day (success or not), so a broken source can't make it
  // retry every minute; the digest re-collects if this one failed.
  const already = await prisma.collectRun.findFirst({ where: { startedAt: { gte: since } } });
  if (already) return;
  await runCollect().catch((err) => console.error("[scheduler] collect failed:", err));
}
