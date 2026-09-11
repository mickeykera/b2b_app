import "dotenv/config";

import { reconcileSchedules } from "../lib/scheduler";
import { logger } from "../lib/logger";

/**
 * Long-running scheduler reconciler.
 *
 * Every tick it diffs the live BullMQ scheduler set against the desired set
 * derived from active workflows and repairs any drift (missing upserted,
 * stale removed). This keeps cron schedules correct even if a deploy crashes
 * mid-write or a workflow was deactivated out-of-band.
 */

const INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.SCHEDULER_RECONCILE_INTERVAL_MS ?? 60_000),
);

let stop = false;

async function tick(): Promise<void> {
  try {
    const result = await reconcileSchedules();
    logger.info("scheduler reconciled", {
      ...result,
      queue: "relayflow.workflow-runs",
    });
  } catch (cause) {
    logger.error("scheduler reconcile failed", { error: cause });
  }
}

async function main(): Promise<void> {
  logger.info("scheduler reconciler started", {
    intervalMs: INTERVAL_MS,
  });
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  timer.unref();

  const shutdown = (signal: string) => {
    stop = true;
    clearInterval(timer);
    logger.info("scheduler reconciler stopped", { signal });
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stop) {
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().catch((cause) => {
  logger.error("scheduler crashed", { error: cause });
  process.exit(1);
});