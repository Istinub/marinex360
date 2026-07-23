# MarineX360

Internal digital field management system for TKMR Marine & Offshore Engineering Pte. Ltd.
Local-first development stack (per **D-001** — AWS provisioning deferred). Everything here is
built so the eventual cloud move is **config-only**, not a rewrite: all local↔cloud
differences live in `.env`, and the local services are exact stand-ins for AWS managed ones.

> **PDPA / INFRA-1:** local dev uses **synthetic seed data only**. Never place real client or
> personal data on local machines, in fixtures, or in commits. Singapore-region hosting is the
> gate before any real PII. This repository is currently public and must stay synthetic-only.

## Project status

| Area | State |
| --- | --- |
| Sprint 0 | Complete except S0-5 (QA sign-off, in review) and S0-6 (mobile real-backend re-run) |
| Contract | `INTERFACE_CONTRACT.md` **v1.1** — canonical |
| Schema | `prisma/schema.prisma` **v1.1**, 24 models — canonical, migrated |
| Phase 1 | P1-1 auth, P1-2 branch scoping, P1-3 CRM, P1-5 Job Orders, P1-6 variations, P1-10 audit → **Done, DB-verified**. P1-4 (Vessel) in progress. P1-7/8/9 (web UI), P1-11 (QA pack), P1-12 (ops) not started. |
| Tests | **98 passing** across 10 files — unit + DB-backed integration |

Decisions are tracked in `RESOLVED_DECISIONS.md` (OD-01…05 core architecture, D-001…D-020
build decisions, CC-1…CC-9 contract changes). Read it before assuming behaviour not covered
by your own brief.

## Prerequisites

- Node.js 22.x
- Docker + Docker Compose

## One-command setup

```
cp .env.example .env        # then edit secrets if you like
npm install
npm run setup               # compose up --wait + prisma migrate dev + db seed
```

`npm run setup` brings up Postgres, Redis, MinIO (+ bucket) and maildev, applies migrations,
and seeds synthetic data.

## Local services (→ cloud equivalent)

| Service | Local | Ports | Cloud target |
| --- | --- | --- | --- |
| Database | `postgres:16` | 5432 | AWS RDS PostgreSQL (ap-southeast-1) |
| Cache + queue | `redis:7` | 6379 | AWS ElastiCache |
| Object storage | MinIO | 9000 (API), 9001 (console) | AWS S3 (ap-southeast-1) |
| Email | maildev | 1025 (SMTP), 1080 (web UI) | SendGrid / SES |

MinIO console: <http://localhost:9001> (`minioadmin` / `minioadmin`).
Maildev inbox: <http://localhost:1080>.

## Database roles — audit immutability (D-014)

The app runs as a **non-owner** role so that append-only tables are protected at the database
layer, not just in application code. Two connection URLs, deliberately different:

| Var | Role | Used by |
| --- | --- | --- |
| `DATABASE_URL` | `marinex_app` (non-owner) | app runtime + tests |
| `DIRECT_DATABASE_URL` | `marinex` (owner) | migrations, seed, Prisma Studio |
| `SHADOW_DATABASE_URL` | `marinex` (owner) | Prisma shadow DB |

`marinex_app` has `UPDATE`/`DELETE` **revoked** on `AuditEntry` and `JobStatusHistory` — they
are insert-and-read only. `Invoice`/`InvoiceLine` immutability is conditional (after
`issuedAt`) and is enforced in the service layer instead. Role provisioning lives in
`infra/postgres/provision-app-role.sql`; the `REVOKE` must remain the **last** statement in
that file, or a later `GRANT` will silently undo it.

## Common commands

```
npm run dev:up        # start the stack (waits until healthy)
npm run dev:down      # stop
npm run dev:reset     # wipe volumes and restart fresh
npm run db:migrate    # prisma migrate dev
npm run db:seed       # synthetic seed
npm run smoke:s3      # S3/MinIO put/get round-trip via the storage adapter
npm run smoke:pdf     # hello-world PDF render (run inside the worker image, see below)
npm run lint && npm run typecheck && npm run test && npm run build
```

## Tests

```
npm test -w @marinex360/api                    # unit suites only
RUN_DB_TESTS=1 npm test -w @marinex360/api     # + DB-backed integration suites
```

Integration suites are guarded behind `RUN_DB_TESTS=1` so the fast unit path never needs a
live database. They require the stack running and the seed loaded (`npm run db:seed`); a
`NotFoundError: No User found` in `beforeAll` means the seed is missing after a volume reset.

`apps/api/test/integration/` covers Job Orders (JOSM gating, audit write-through,
version-conflict, DB-level audit immutability), branch scoping (cross-branch → `NOT_FOUND`,
scope checked before version), and CRM (contact-by-reference, soft delete, D-019 join-based
Contact scoping).

## The config seam (why the cloud move is config-only)

The app never constructs an S3 client or a DB connection directly with literals. It reads
`DATABASE_URL`, `REDIS_URL`, and the `S3_*` vars from the environment, and uses the shared
`@marinex360/storage` adapter for files. Switching to AWS is a `.env` change:

| Var | Local (MinIO) | AWS (S3) |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9000` | unset / regional endpoint |
| `S3_FORCE_PATH_STYLE` | `true` | `false` |
| `S3_REGION` | `ap-southeast-1` | `ap-southeast-1` |

## Repo layout

```
apps/api          Fastify API — routes, service layer, domain logic, tests
apps/worker       BullMQ workers + Puppeteer (Chromium baked into the image)
packages/storage  Shared S3/MinIO adapter — the config seam
prisma            schema (datasource/generator = DevOps seam; models = TL/BE) + migrations + seed
infra/postgres    shadow-db init + non-owner app-role provisioning
.github           CI + Dependabot
```

All data access goes through the **service layer** in `apps/api/src/services/` — branch
scoping, optimistic version checks, audit writes and idempotency live there. Routes and
clients never touch Prisma directly; this is what keeps a future multi-tenant split cheap.

## CI

Open a PR; the `CI` workflow runs lint, typecheck, `prisma validate`, migrate, tests, and
build, and builds both Docker images. `main` is protected (PR + green CI required).

Dependabot major-version bumps are expected to fail CI by design (pinned Prisma/Node) — do
not merge them; see **DEP-1**.

## Notes / deferred

- AWS provisioning (RDS, ElastiCache, ECS) and INF-Q1–Q4/Q6 are deferred with the cloud
  decision. TLS 1.3 is a cloud concern (INF-Q4); local is plain HTTP on localhost.
- **INF-Q5 is NOT deferred:** Apple Developer Program + Google Play Console accounts for
  internal mobile distribution have procurement lead time and are needed for Phase 2 builds.
- Sync delta cursor is currently ISO-timestamp based; a monotonic `changeSeq` column is
  required before Phase 2 real field sync (**D-012**).