# MarineX360

Internal digital field management system for TKMR Marine & Offshore Engineering Pte. Ltd.
Local-first development stack (per **D-001** — AWS provisioning deferred). Everything here is
built so the eventual cloud move is **config-only**, not a rewrite: all local↔cloud
differences live in `.env`, and the local services are exact stand-ins for AWS managed ones.

> **PDPA / INFRA-1:** local dev uses **synthetic seed data only**. Never place real client or
> personal data on local machines, in fixtures, or in commits. Singapore-region hosting is the
> gate before any real PII.

## Prerequisites

- Node.js 22.x
- Docker + Docker Compose

## One-command setup

```bash
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

MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`).
Maildev inbox: http://localhost:1080.

## Common commands

```bash
npm run dev:up        # start the stack (waits until healthy)
npm run dev:down      # stop
npm run dev:reset     # wipe volumes and restart fresh
npm run db:migrate    # prisma migrate dev
npm run db:seed       # synthetic seed
npm run smoke:s3      # S3/MinIO put/get round-trip via the storage adapter
npm run smoke:pdf     # hello-world PDF render (run inside the worker image, see below)
npm run lint && npm run typecheck && npm run test && npm run build
```

## The config seam (why the cloud move is config-only)

The app never constructs an S3 client or a DB connection directly with literals. It reads
`DATABASE_URL`, `REDIS_URL`, and the `S3_*` vars from the environment, and uses the shared
`@marinex360/storage` adapter for files. Switching to AWS is a `.env` change:

| Var | Local (MinIO) | AWS (S3) |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9000` | unset / regional endpoint |
| `S3_FORCE_PATH_STYLE` | `true` | `false` |
| `S3_REGION` | `ap-southeast-1` | `ap-southeast-1` |

## Verifying S0-3 acceptance

1. **Stack healthy** — `npm run dev:up` → Postgres & Redis healthy; `minio-init` completes
   (bucket created); maildev up.
2. **Schema/migrations** — `npm run db:migrate` runs clean and creates tables. *Note:* this
   repo currently carries a **temporary 6-model baseline** in `prisma/schema.prisma` so the
   pipeline is runnable now; the full ~24 tables appear once TL/BE commit the canonical schema
   (the config blocks at the top of that file are the DevOps-owned seam and stay).
3. **Object storage** — `npm run smoke:s3` → put/get round-trip passes against MinIO.
4. **Worker PDF** —
   ```bash
   docker build -f apps/worker/Dockerfile -t marinex-worker .
   docker run --rm -v "$PWD/tmp:/app/tmp" marinex-worker node apps/worker/scripts/render-smoke.mjs
   ```
   writes `tmp/render-smoke.local.pdf`.
5. **CI** — open a PR; the `CI` workflow runs lint, typecheck, prisma validate, migrate,
   tests, build, and builds both Docker images. `main` is protected (PR + green CI required).
6. **One-command setup** — `npm run setup` (above).

## Repo layout

```
apps/api        Fastify API (placeholder health route; BE owns real routes)
apps/worker     BullMQ workers + Puppeteer (Chromium baked into the image)
packages/storage  Shared S3/MinIO adapter — the config seam
prisma          schema (datasource/generator = DevOps seam; models = TL/BE) + seed
infra/postgres  shadow-db init script
.github         CI + Dependabot
```

## Notes / deferred

- AWS provisioning (RDS, ElastiCache, ECS) and INF-Q1–Q4/Q6 are deferred with the cloud
  decision. TLS 1.3 is a cloud concern (INF-Q4); local is plain HTTP on localhost.
- **INF-Q5 is NOT deferred:** Apple Developer Program + Google Play Console accounts for
  internal mobile distribution have procurement lead time and are needed for Phase 2 builds.
