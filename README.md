# RelayFlow

A **multi-tenant B2B Workflow Automation and Integrations platform** built on
Next.js 16 (App Router), PostgreSQL + Prisma 7, and Redis + BullMQ.

RelayFlow lets organizations ingest signed webhooks, run deterministic
trigger → filter → transform → action pipelines (a validated DAG), retry
failures with exponential backoff + jitter, and observe every execution —
including real-time step logs and dead letters — from a dense, enterprise-style
dashboard. It is designed from the start around **tenant isolation, tamper
evident auditing, and fail-fast configuration**, the properties an acquirer's
due-diligence team will actually check.

---

## Feature checklist

| Area | Status | Notes |
| --- | --- | --- |
| Webhook ingestion | Implemented | HMAC schemes: `relay`, `github`, `stripe`; replay window, body-size cap, token-bucket rate limits (IP / tenant / endpoint) |
| DAG execution engine | Implemented | Zod-validated graphs, cycle detection, topo sort, filter short-circuit, retries (full-jitter exponential), deterministic idempotent `executionId` |
| Action dispatchers | Implemented | HTTP, Slack, Discord, SendGrid, HubSpot; secrets resolved from encrypted credentials at execution time |
| Real-time run logs | Implemented | `onStep` → `step_logs` rows streamed during execution |
| Dead-letter queue | Implemented | Per-step DLQ with payload + error + attempts; DB-backed |
| Audit log | Implemented | Append-only (DB trigger `0001_audit_trigger`), fire-and-forget writes |
| Secret encryption | Implemented | AES-256-GCM, HKDF per-tenant keys, `MASTER_ENCRYPTION_KEY`, masked everywhere |
| Auth + sessions | Implemented | scrypt password hashing; HS256 JWT sessions with per-row revocation, session list, pruning; TOTP MFA with recovery codes; password reset links; org invitations; token-bucket brute-force throttling on login |
| Scheduling | Implemented | BullMQ `upsertJobScheduler` per (org, workflow, trigger) cron; long-running scheduler loop self-heals stale entries |
| Observability | Implemented | Structured JSON logs (`lib/logger`), `x-request-id` propagation (proxy + app routes), append-only audit trail |
| Admin queue metrics | Implemented | `GET /api/admin/queue` (admin-only): BullMQ job counts, live in-progress, scheduler count; 503 if Redis unreachable |
| Test webhook sender | Implemented | UI button + `POST /api/workflows/:id/test-webhook` self-signs and posts a relay webhook to exercise the live path end-to-end |
| Workflow builder | Implemented | `/workflows/new` guided builder UI (webhook/schedule triggers, http/slack actions) with live DAG preview |
| Run metrics + export | Implemented | Overview 14-day stacked-bar SVG chart; `GET /api/orgs/runs/export` CSV (status/workflow filters, 50k cap) |
| UI / dashboard | Implemented | Overview, workflows, runs, credentials, audit, settings (password/MFA/team); dark mode; zinc palette |
| Tests | Implemented | Vitest: 61 tests across crypto, signatures, DAG runner, paths, TOTP, recovery codes |
| CI pipeline | Implemented | GitHub Actions: Node 22, `tsc`, `eslint`, `vitest`, `check:env`, `next build`; env dummies for CI (no secrets needed) |

---

## Architecture

```
                     ┌────────────────────────────────────────────────┐
   Sender ─────────▶ │ /api/webhooks/:org/:endpoint                    │
   (HMAC-signed)     │  rate limits → signature check → replay window  │
                     └───────────────┬────────────────────────────────┘
                                     │ enqueue job (jobId = executionId)
                                     ▼
                     ┌────────────────────────────────────────────────┐
                     │ BullMQ "relayflow.workflow-runs"  (Redis)       │
                     └───────────────┬────────────────────────────────┘
                                     ▼
                     ┌────────────────────────────────────────────────┐
                     │ Worker (scripts/worker.ts)                      │
                     │  createRun(idempotency)                         │
                     │  runWorkflow(DAG runner)                        │
                     │   ├─ filters: evaluate MatchPath conditions     │
                     │   ├─ transforms: JSON path set/get + templates  │
                     │   └─ actions: dispatchStep (outbound HTTP/…)    │
                     │  stream step logs → step_logs                   │
                     │  success → run.status = succeeded               │
                     │  failure → dead_letters row + audit             │
                     └────────────────────────────────────────────────┘
```

### Multi-tenancy

Every table carries an `organizationId`. The repository layer
(`lib/data/*`) filters every query by `organizationId` — there is **no
tenant-agnostic query path**. Credentials additionally scopes decryption: a
credential id only ever decrypts under the owning organization, and webhook
ingress resolves endpoints under `(organizations.slug, webhook_endpoints.slug)`
together.

### Secrets at rest

- `MASTER_ENCRYPTION_KEY` (base64, exactly 32 bytes) is the root.
- Per tenant, a Key-Derivation-Function (HKDF-SHA256) derives an AES-256-GCM key
  salted with the organization id, so ciphertext from one tenant cannot be
  decrypted with another tenant's (or the master) key directly.
- Envelope format: `v1:<iv>:<tag>:<ciphertext>` (base64url).
- Credentials are **not re-displayed**; the UI stores only a masked suffix.

### Idempotency and replays

`executionId = run_<sha256(orgId · workflowId · eventId · occurredAt)>[0:20]`.
BullMQ uses it as `jobId` (a replayed delivery cannot enqueue twice), and the
DB has `@@unique([organizationId, executionId])` as a second guard.

### Webhook signature schemes

| Scheme | Signature source | Replay protection |
| --- | --- | --- |
| `relay` | `x-relay-signature: sha256=hex` over `${timestamp}.${body}` | `x-relay-timestamp` window |
| `github` | `x-hub-signature-256` over body | none (HMAC only) |
| `stripe` | `stripe-signature: t=…,v1=…` | embedded `t` window |

All comparisons run in constant time (`crypto.timingSafeEqual`).

---

## Stack / versions (exact-pinned)

Node.js **>= 20.19** (developed on 24, uses type-stripping for scripts).

| Package | Version |
| --- | --- |
| next / react / react-dom | 16.3.4 / 19.3.0 |
| prisma / @prisma/client | 7.10.0 |
| @prisma/adapter-pg + pg | 7.10.0 / 8.23.0 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 |
| zod | 4.6.1 |
| jose | 6.2.12 |
| bullmq / ioredis | 6.3.4 / 6.0.0 |
| radix-ui | 1.6.7 |
| typescript / eslint | 5.9.3 / 9.39.5 |
| vitest | 5.0.0 |

All dependencies are `--save-exact`. `npm audit` reports **0 vulnerabilities**
(using `overrides` for `deepmerge-ts` and `mysql2`).

---

## Getting started

### 1. Prerequisites

- PostgreSQL 14+ (a `DATABASE_URL`)
- Redis 6+ (a `REDIS_URL`)
- Network access to npm

### 2. Configure

```bash
cp .env.example .env
# fill in DATABASE_URL, REDIS_URL, MASTER_ENCRYPTION_KEY,
# AUTH_JWT_SECRET (>=32 chars), APP_BASE_URL

npm install
```

Generate a strong master key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Provision

```bash
npm run setup -- --seed        # generate client + migrate deploy + optional demo seed
```

Or step by step:

```bash
npm run db:generate
npm run db:deploy              # applies prisma/migrations (incl. append-only audit trigger)
npm run db:seed                # optional demo data (org "acme", admin@acme.dev)
```

### 4. Run

```bash
npm run dev                    # app (one terminal)
npm run worker                 # run worker (second terminal)
npm run scheduler              # cron scheduler refresh (third terminal, optional)
```

Production:

```bash
npm run build && npm start
```

The seed prints demo credentials (`admin@acme.dev` /
`RelayFlow-Dev-123!`). The seeded workflow exposes a webhook at
`{APP_BASE_URL}/api/webhooks/acme/orders` signed with the `relay` scheme.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` | ESLint (flat config, `eslint .`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite (61 tests) |
| `npm run check:env` | Fail-fast env validation |
| `npm run db:generate` | Generate Prisma client (`src/generated/prisma`) |
| `npm run db:migrate` | Push a new migration against dev DB |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:diff` | Render initial-schema SQL (regenerates `0000_init`) |
| `npm run db:seed` | Demo data |
| `npm run worker` | Run worker (action executor; structured JSON logs) |
| `npm run scheduler` | Long-running scheduler loop (reconciles cron schedules; logs reconciled counts) |
| `npm run setup` | Provision a fresh environment |

---

## Configuration reference (`.env.example`)

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | no | `development` default |
| `APP_NAME` | no | default `RelayFlow` |
| `APP_BASE_URL` | **yes** | canonical origin (webhook URLs, cookie `Secure`) |
| `DATABASE_URL` | **yes** | `postgresql://` pooled URL |
| `DIRECT_URL` | no | optional unpooled URL for migrations |
| `REDIS_URL` | **yes** | `redis://` or `rediss://` |
| `MASTER_ENCRYPTION_KEY` | **yes** | base64 32-byte key |
| `AUTH_JWT_SECRET` | **yes** | ≥ 32 chars, HS256 |
| `AUTH_SESSION_TTL_DAYS` | no | default 7 |
| `WEBHOOK_MAX_AGE_SECONDS` | no | signature replay window, default 300 |
| `WEBHOOK_BODY_SIZE_LIMIT_BYTES` | no | default 1,000,000 |
| `RATE_LIMIT_*` | no | IP / tenant / webhook token buckets |
| `BOOTSTRAP_*` | no | seed-only: `BOOTSTRAP_ORG_NAME`, `BOOTSTRAP_ORG_SLUG`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` |
| `SCHEDULER_RECONCILE_INTERVAL_MS` | no | scheduler loop interval (default 60 000 ms, minimum 5 000 ms) |
| `WORKER_CONCURRENCY` | no | parallel job concurrency per worker (default 5) |
| `EMAIL_FROM` | no | outbound sender for password-reset and invitation emails (console output in dev) |
| `EMAIL_RESEND_API_KEY` | no | optional Resend REST API key; when set, emails are sent over HTTPS instead of logged to the console |
| `PASSWORD_RESET_TTL_HOURS` | no | expiry window for reset tokens, default 1 hour |
| `INVITE_TTL_DAYS` | no | expiry window for org invitations, default 7 days |

If any required variable is missing or invalid, the app **fails fast at
startup** (`npm run check:env`, and `next build`/`next start` include it).

---

## Data model

14 tables — `organizations`, `users`, `credentials`, `workflows`, `triggers`,
`actions`, `workflow_runs`, `step_logs`, `dead_letters`, `webhook_endpoints`,
`audit_logs`, `api_keys`, `sessions`, `invitations`. Full definitions live in `prisma/schema.prisma`.

Pipelines are stored as JSON (`workflows.graph`) and projected into relational
`triggers` / `actions` rows plus `webhook_endpoints` (each webhook trigger gets
an encrypted HMAC secret persisted across saves, so URLs remain stable).

---

## Security notes

- **Tenant isolation** — org-scoped filtering on every repository query; no
  tenant-agnostic read path.
- **At-rest encryption** — tenant-derived AES-256-GCM keys; stored ciphertext
  only.
- **Transport** — production `Set-Cookie` uses `Secure`; Next security headers
  (`X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `CSP`) are set in `next.config.ts`.
- **Auth** — scrypt password hashing; HS256 JWTs with issuer/audience checks;
  every session is a database row (`sessions`); logout and password change
  revoke tokens; optional TOTP with one-use recovery codes; token-bucket
  rate limits on sign-in (per-IP + per-email) to slow credential stuffing.
- **Password reset** — time-limited, single-use tokens stored as SHA-256
  hashes; every reset invalidates all existing sessions for that user.
- **Invitations** — token-based org invites with configurable TTL; accounts are
  created with a pre-scoped role, preventing privilege escalation.
- **Audit** — append-only trigger blocks `UPDATE`/`DELETE` on `audit_logs`;
  audit writes are fire-and-forget so they can never derail the primary
  operation.
- **Structured logging** — all routes and the worker emit JSON-lines with a
  request-scoped `x-request-id` (propagated by the proxy); no secrets are
  logged.
- **Input validation** — Zod for env, request bodies, and workflow graphs;
  outbound payloads are template-interpolated through a validated JSON path
  helper.

---

## Testing & verification

```bash
npm test          # 61 tests, 6 files
npm run typecheck # 0 errors
npm run lint      # 0 errors, 0 warnings
npm run build     # clean, dynamic routes + proxy
```

Tests cover the DAG runner (retry/backoff/filter/DLQ semantics), webhook
signature verification for all three schemes, encryption envelope + tamper
detection + API-key masking, JSON path helpers, RFC 6238 TOTP vectors, and
recovery-code generation/normalization.

## Operations

- **Worker**: `npm run worker` drains the BullMQ queue and executes runs;
  emits structured JSON logs (`lib/logger`).
- **Scheduler**: `npm run scheduler` runs a long-lived loop that periodically
  reconciles active-workflow cron schedules against the live Redis scheduler
  set, self-healing drift after crashes or deactivations.
- **Health**: `GET /api/health` checks DB + Redis liveness.
- **Queue metrics**: `GET /api/admin/queue` (admin-only) returns BullMQ job
  counts, live in-progress, and scheduler count.
- **Observability**: run detail shows every step with status, attempt,
  HTTP code, duration, error, and output; failed runs also land in the dead
  letter store.