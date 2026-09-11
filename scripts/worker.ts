import "dotenv/config";

import { createWorker } from "../lib/workers";
import { logger } from "../lib/logger";

const worker = createWorker(Number(process.env.WORKER_CONCURRENCY ?? 5));

async function shutdown(signal: string): Promise<void> {
  logger.info("worker draining", { signal });
  await worker.close();
  logger.info("worker stopped", { signal });
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

logger.info("worker listening", { queue: "relayflow.workflow-runs" });