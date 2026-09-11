#!/usr/bin/env node
/**
 * One-shot provisioning for a RelayFlow environment.
 *
 *   npm run setup
 *
 * Steps:
 *   1. Validates required environment variables (fails fast).
 *   2. Generates the Prisma client.
 *   3. Applies pending migrations (prisma migrate deploy).
 *   4. Options:
 *        --seed   also seeds demo data (dev only)
 *        --worker starts the run worker in the foreground.
 *
 * Intended for production / staging provisioning. Requires a reachable
 * PostgreSQL and Redis (via DATABASE_URL / REDIS_URL).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
config({ path: join(root, ".env") });

const required = {
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY,
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
  APP_BASE_URL: process.env.APP_BASE_URL,
};

const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
if (missing.length > 0) {
  console.error(`Refusing to provision: missing environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill in real values first.");
  process.exit(1);
}

function run(label, command, args, opts = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, env: process.env, ...opts });
  if (result.status !== 0) {
    console.error(`Setup failed at step "${label}" (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

const seed = process.argv.includes("--seed");
if (seed) {
  console.log("\nProvisioning WITH demo seed data.");
}

run("Generating Prisma client", "npx", ["prisma", "generate"]);
run("Applying migrations", "npx", ["prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL ?? "" },
});

if (seed) {
  run("Seeding demo data", "npx", ["tsx", "--tsconfig", "tsconfig.scripts.json", "prisma/seed.ts"]);
}

console.log("\nSetup complete.");
console.log("  Run the run worker:   npm run worker");
console.log("  Run the scheduler:    npm run scheduler");
console.log("  Start the app:        npm run build && npm start");