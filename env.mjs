// Startup environment gate.
//
// Imported by `next.config.mjs`/`next.config.ts`, package scripts and CI so
// that a missing or invalid configuration aborts before the server starts.
// Run standalone with:  npm run check:env
//
// This file is plain ESM so it can execute under Node directly; the typed
// schema and validator live in `lib/env.ts` (Node 22.6+/24 strips types).

import "dotenv/config";
import { getEnv } from "./lib/env.ts";

const env = getEnv();
console.log(
  `[env] configuration valid (${env.NODE_ENV}). DATABASE_URL/MASTER_ENCRYPTION_KEY/AUTH_JWT_SECRET present.`,
);

export { env, envSchema, parseEnv, ConfigError } from "./lib/env.ts";
export default env;