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
//   - collect: every sources.collectEveryHours (RSS / Google News)

const TICK_MS = 60_000;
const GRACE_MINUTES = 4 * 60; // a restart within 4h after the slot still runs today
const DEFAULT_SLOT = 8 * 60;

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
  const every = cfg.sources?.collectEveryHours;
  if (!every) return;
  // Measured from the last attempt (success or not), so a broken source can't
  // make it retry every minute.
  const last = await prisma.collectRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (last && Date.now() - last.startedAt.getTime() < every * 3_600_000) return;
  await runCollect().catch((err) => console.error("[scheduler] collect failed:", err));
}
