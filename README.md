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
| Sprint 0 | Complete |
| Phase 1 (Auth/RBAC/CRM/Job Orders/web office app) | **Complete** |
| Phase 3 (Invoicing, payments, PDF generation, documents/certificates) | **Complete** |
| Phase 2 (Mobile field-execution app — offline sync, checklists, materials, signature, Device/PIN login) | **Built**, ongoing device-verification pass |
| Phase 6 (Client portal — guest/registered intake, request queue) | **In progress** |
| Phase 8 (Quotations, Vendor management, public job-progress tracking link, per-job branding, admin dev tools) | **Built**, most items verified |
| Contract | `INTERFACE_CONTRACT.md` — canonical, tracked in git (confirm it's current before relying on it; it has previously drifted from the real code — see D-055/D-056) |
| Schema | `prisma/schema.prisma` — canonical, migrated. Far more models than early versions of this doc described — see `prisma/schema.prisma` directly for the current, real list rather than trusting a count here. |
| Tests | Last confirmed full run: **279 passing across 39 files** (API, `RUN_DB_TESTS=1`). Re-run this yourself before trusting a specific number — it changes often. |

Decisions are tracked in `RESOLVED_DECISIONS.md` (OD-01…17, D-001…D-092 and counting,
CC-1…CC-18 and counting). Read it before assuming behaviour not covered by your own brief —
this project has a real, repeated history of two agents disagreeing until someone actually
read the file.

## Prerequisites

- Node.js 22.x (required — the mobile app specifically needs `>=22 <23`; see D-058)
- Docker + Docker Compose

## Steps for developers — first-time setup

Follow this in order. Each step assumes the previous one succeeded.

1. **Clone and install**
   ```
   git clone https://github.com/Istinub/marinex360.git
   cd marinex360
   npm install
   ```

2. **Environment file**
   ```
   cp .env.example .env
   ```
   The defaults work for local dev as-is. Leave `SKIP_ADMIN_MFA` unset/false — it's a
   dev-only convenience flag (D-087), never set it true outside your own local testing.

3. **Start the local stack**
   ```
   npm run dev:up
   ```
   Brings up Postgres, Redis, MinIO (+ bucket), and Maildev, and waits until healthy.

4. **Apply the database schema and seed data**
   ```
   npm run db:migrate
   npm run db:seed
   ```
   Seeds a fixed set of 7 accounts (3 technician devices + Operations, Finance, Director,
   Admin — see below) plus reference data (checklist categories, sample clients/vessels).

   If either command fails with a generic Prisma schema-engine error rather than a clear
   message, this environment may need the workaround used before: apply the pending
   migration SQL directly via `DIRECT_DATABASE_URL`, then mark it resolved with
   `npx prisma migrate resolve --applied <migration_name>`. This has come up more than
   once across different dev environments — don't assume it means the migration itself is
   broken.

5. **Confirm you're in sync** (do this any time you pull new work, not just once)
   ```
   npx prisma migrate status
   ```
   Run this whenever you switch between environments (e.g. WSL2 ↔ Codespaces) — each has
   its own database, and a migration applied in one does not automatically reach the other.

6. **Start each app** (separate terminals, or see the worker note below)
   ```
   npm run dev -w @marinex360/api       # http://localhost:3000
   npm run dev -w @marinex360/web       # office app, Vite dev server
   npm run dev -w @marinex360/mobile    # field app, Vite dev server
   npm run dev -w @marinex360/worker    # background jobs — see note below
   ```

7. **Worker-specific setup (PDF generation)**
   The worker needs a real Chromium/Chrome binary for Puppeteer. Locally (outside Docker),
   set `PUPPETEER_EXECUTABLE_PATH` in your `.env` to a real binary — the cleanest way to get
   one is:
   ```
   npx puppeteer browsers install chrome
   ```
   then point `PUPPETEER_EXECUTABLE_PATH` at the path it prints. Inside the Docker image,
   this is already baked in (see `apps/worker/Dockerfile`) and needs no action.

   **The worker is not a `docker-compose` service** — it only runs via the manual command
   above. If reports/invoices/quotation PDFs are stuck on "Generating...", check first
   whether the worker process is actually running before assuming a code bug.

8. **Log in and confirm it's working**
   - Web (office): `director@tkmr.local` or `admin@tkmr.local`, password
     `MarineX360-dev!`, plus TOTP (unless `SKIP_ADMIN_MFA=true` is set for Admin).
   - Mobile (field): PIN-only. Device-1 → `0000`, Device-2 → `0002`, Admin device →
     `1111`, Director device → `1234`.

9. **Run the test suite** before making changes, to confirm your environment is genuinely
   healthy, not just "looks started":
   ```
   npm run typecheck -w @marinex360/api
   RUN_DB_TESTS=1 npm run test -w @marinex360/api
   ```
   `RUN_DB_TESTS=1` runs against an **isolated `marinex360_test` database**, separate from
   your dev data — this is deliberate (see Tests section below) so running the suite never
   pollutes or gets polluted by whatever you're manually testing in the main dev database.

### Mobile device setup (Android, via WSL2)

Testing `apps/mobile` requires a real Android device connected via `adb` — per **D-067**,
browser testing alone cannot verify SQLite/offline/camera/GPS/permissions/lifecycle behavior
(see debugging-principles lesson #6 in `RESOLVED_DECISIONS.md`). This is a one-time local
machine setup; the bridge itself does not persist across a laptop restart, but the
bind/authorization does. **This only works from WSL2 (or a similar local machine with real
USB access) — not from a cloud Codespace**, which cannot get USB device passthrough.

#### First-time setup

1. Install `adb` in WSL2:
   ```
   sudo apt update && sudo apt install -y android
   ```
   (Note: the package is `android`, not `android-tools-adb` — that name does not exist on
   Ubuntu 24.04.)
2. On the Android phone: enable Developer Options (Settings → About Phone → tap Build Number
   7 times), then enable USB Debugging under Developer Options.
3. Bridge the USB device from Windows into WSL2 via [`usbipd-win`](https://github.com/dorssel/usbipd-win):
   ```
   # in an admin PowerShell, list devices to find the busid
   usbipd list
   usbipd bind --busid <busid>
   usbipd attach --wsl --busid <busid>
   ```
   If the device shows as "in error state," run `usbipd unbind --busid <busid>` then
   `usbipd bind`/`attach` again.
4. In WSL2, confirm the device is visible:
   ```
   adb devices
   ```
   The phone will prompt "Allow USB debugging?" — tap Allow. If the device drops to
   `unauthorized` or disappears mid-prompt, re-run the `usbipd attach` command once more
   after accepting the prompt.
5. Confirmed working state looks like:
   ```
   List of devices attached
   f24d1d41        device
   ```
   (not `unauthorized`, not `offline`, not empty)

#### Reconnecting later (phone unplugged/replugged, or laptop restarted)

The bind/authorization persists — you do not need to repeat steps 1–4. Just:
```
& "C:\Program Files\usbipd-win\usbipd.exe" attach --wsl --busid <busid>
```
then `adb devices` in WSL2 to confirm.

#### Building and installing the debug APK

```
npm run cap:sync -w @marinex360/mobile
cd apps/mobile/android
ANDROID_HOME=/usr/lib/android-sdk ANDROID_SDK_ROOT=/usr/lib/android-sdk \
  GRADLE_USER_HOME=/tmp/marinex360-gradle ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

#### Fallback: no physical device available

If a physical device genuinely isn't available, fall back to an Android emulator (AVD) via
Android Studio — this plan is deprioritized (D-066/D-069) but documented as a backup, since a
real device is faster and more representative for camera/GPS/permissions/background-foreground
behavior than an emulator typically is.

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
layer, not just in application code. Three (not two) connection URL pairs now exist — one for
the main dev database, and a fully separate pair for tests:

| Var | Role | Used by |
| --- | --- | --- |
| `DATABASE_URL` | `marinex_app` (non-owner) | app runtime |
| `DIRECT_DATABASE_URL` | `marinex` (owner) | migrations, seed, Prisma Studio |
| `SHADOW_DATABASE_URL` | `marinex` (owner) | Prisma shadow DB |
| `DATABASE_URL_TEST` | `marinex_app` (non-owner) | integration tests only, isolated DB |
| `DIRECT_DATABASE_URL_TEST` | `marinex` (owner) | test DB migrations |

`marinex_app` has `UPDATE`/`DELETE` **revoked** on `AuditEntry`, `JobStatusHistory`, and
`Payment` — they are insert-and-read only, enforced at the database grant level, not just in
application code (confirmed even a maintenance script gets denied — see the D-080-era cleanup
incident). Role provisioning lives in `infra/postgres/provision-app-role.sql`; the `REVOKE`
must remain the **last** statement in that file, or a later `GRANT` will silently undo it.

## Common commands

```
npm run dev:up        # start the stack (waits until healthy)
npm run dev:down      # stop
npm run dev:reset     # wipe volumes and restart fresh
npm run db:migrate    # prisma migrate dev
npm run db:seed       # synthetic seed (fixed 7-account set)
npm run smoke:s3      # S3/MinIO put/get round-trip via the storage adapter
npm run smoke:pdf     # hello-world PDF render (run inside the worker image, see below)
npm run lint && npm run typecheck && npm run test && npm run build
```

## Tests

```
npm test -w @marinex360/api                    # unit suites only
RUN_DB_TESTS=1 npm test -w @marinex360/api     # + DB-backed integration suites
```

**Integration tests run against an isolated `marinex360_test` database, not your main dev
database.** This was a deliberate fix (see D-080) after repeated incidents of automated test
runs silently filling the dev database with thousands of throwaway fixture rows. The test
harness (`apps/api/test/testDatabase.ts`) enforces this — it asserts the resolved database
name ends in `_test` before running anything, so it cannot silently point at the wrong
database even if an env var is misconfigured.

`apps/api/test/integration/` now covers a large and growing surface — Job Orders (state
machine, branch scoping, audit write-through, version-conflict), CRM, invoicing, payments,
variations, checklist categories/templates, devices/PIN auth, job requests, quotations, the
public job-progress link, and more. Check the directory directly for the current real list
rather than trusting an enumerated one here.

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
apps/web           Vue 3 office app — Clients/Vessels/Job Orders/Invoices/Quotations/
                    Settings/Analytics, used by Operations/Finance/Director/Admin
apps/mobile        Vue 3 + Capacitor field app — offline-first technician execution,
                    Device/PIN login, native Android build
apps/worker        BullMQ workers + Puppeteer (Chromium baked into the Docker image) —
                    PDF generation for reports/invoices/quotations, email
packages/storage   Shared S3/MinIO adapter — the config seam
prisma             schema (datasource/generator = DevOps seam; models = TL/BE) + migrations + seed
infra/postgres     shadow-db init + non-owner app-role provisioning + readonly-role provisioning
.github            CI + Dependabot
```

All data access goes through the **service layer** in `apps/api/src/services/` — branch
scoping, optimistic version checks, audit writes and idempotency live there. Routes and
clients never touch Prisma directly; this is what keeps a future multi-tenant split cheap.

## CI

Open a PR; the `CI` workflow runs lint, typecheck, `prisma validate`, migrate, tests, and
build, and builds both Docker images. `main` is protected (PR + green CI required).

Dependabot major-version bumps are expected to fail CI by design (pinned Prisma/Node) — do
not merge them; see **DEP-1**.

## Troubleshooting

- **A file/document you're relying on (`RESOLVED_DECISIONS.md`, `INTERFACE_CONTRACT.md`,
  an acceptance-criteria doc) seems out of sync with the real code.** This has happened
  more than once — check `git log --oneline -1 -- <file>` and `git ls-files | grep -i
  <name>` before assuming the document is right. More than one of these files was found to
  have never actually been committed to git at all, despite everyone assuming it was.
- **`npm install` downloads a large Chromium binary into the repo root (`chrome/`)** rather
  than its usual cache location. This should never be committed — it's already covered by
  `.gitignore`; if you see it show up as untracked in `git status`, that's expected, not a
  bug.
- **Reports/invoices/quotation PDFs stuck on "Generating..."** — check the worker process
  is actually running first (it is not a `docker-compose` service, see the setup steps
  above) before assuming a code bug.
- **A 500 error mentioning a table that "does not exist"** almost always means a migration
  that exists in the repo hasn't been applied to *this* environment's database yet — run
  `npx prisma migrate status` before debugging anything else.

## Notes / deferred

- AWS provisioning (RDS, ElastiCache, ECS) and cloud-hosting concerns are deferred with the
  cloud decision (D-001). TLS is a cloud concern; local is plain HTTP on localhost.
- **Apple Developer Program + Google Play Console accounts** for real mobile distribution
  have procurement lead time — needed before any real (non-sideloaded) mobile release.
- Full OD-08 security threat model for the client-facing login surface is still owed —
  the client portal was fast-tracked for demo purposes ahead of that review (see D-071).
- Real RFQ-system integration is planned but not yet started — pending the external RFQ
  system's source being provided (see D-084).