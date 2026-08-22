# MarineX360 — RESOLVED DECISIONS (quick-reference for agents)

**Purpose:** every agent must check this file before assuming behavior that isn't explicitly
in their own role brief. This is a condensed, agent-facing summary — the full record with
rationale, affected areas, and dates lives in `DECISION_LOG.md` (generated) and the
`Decision Log` sheet in `MarineX360_PM_Workbook.xlsx` (source of truth).

**Rule:** if your work would contradict anything below, STOP and flag it in your handoff
under DECISIONS NEEDED — do not silently override it. **Generated:** 2026-07-07.

---

## Debugging principles (hard-won — read before diagnosing any bug)

These two lessons each cost multiple sessions. Internalise them:

1. **Zero `fetch`/`xhr` requests in the browser Network tab = a mounting/routing problem, NOT a
   data problem.** If the app loads its code (scripts 200) but never calls the API, the page
   component isn't mounting — look at the layout/router (`<RouterView/>` vs `<slot/>`, nav
   guards that never call `next()`), not at the API client, store, or backend. Don't re-read
   the data path when the request was never even made. (See D-030.)
2. **CI green ≠ visually correct.** Typecheck/build cannot catch silently-dropped CSS custom
   properties, missing asset files, or a placeholder file standing in for a real one. Only
   opening the rendered page catches these. Confirm asset files actually landed in the repo —
   don't assume that because referencing code compiles, the asset it references exists. (See D-028.)
3. **General:** "built" ≠ "proven." Every slice needs a real pasted test-run / screenshot
   before it's marked Done — an agent's self-report or a green compile is not proof of runtime
   behavior.
4. **A monorepo package with compiled output can silently pass CI for months until the first
   real consumer imports it.** If a workspace package (e.g. `packages/storage`) ships compiled
   `dist/` output (gitignored) rather than raw source, CI's typecheck step must explicitly
   BUILD every such package before typechecking anything that might import it — installing
   `node_modules` is not enough. This gap can sit latent and invisible until whatever code
   happens to be first to import that package. (See D-039.)

---

## Core architecture (OD-01 … OD-05) — locked since planning

- **OD-01 — Inventory:** record-keeping only. Parts/materials are unlimited, admin-editable
  line items on a Job Order. No stock reservation, deduction, reorder automation, or oversell
  logic.
- **OD-02 — Pipeline start:** starts at the Job Order. A JO holds a nullable external
  quote/RFQ reference and a frozen quoted-amount baseline. `JobOrigin` abstracts the source.
  Post-JO scope changes = variation records. RFQ/quotation is out of scope (external system).
- **OD-03 — Immutability & PDPA:** operational/financial records are immutable. Personal
  contact data lives once in `Contact`, referenced by ID elsewhere; anonymisation is
  admin-only, deferred. Invoices are frozen documents.
- **OD-04 — Offline-first:** for the technician's OWN assigned jobs — pre-fetch to on-device
  SQLite, full offline execution, idempotent queued writes (`opId`) shown as pending, delta
  sync with retry/backoff and schema-versioned payloads, biometric/PIN-unlocked long-lived
  session for multi-day offline.
- **OD-05 — Concurrency:** assignment establishes a single owner of execution data; header
  locks once In Progress; collisions via OPTIMISTIC version-check (`version` column,
  reload-and-reapply) — NO pessimistic locking.

## Build decisions (D-001 … D-018) — ratified during the build

| ID | Area | Resolution |
| --- | --- | --- |
| D-001 | Dev environment | Local-first: Docker Compose + GitHub + Actions CI. No AWS now; cloud (ap-southeast-1) deferred to go-live. |
| D-002 | Offline unassigned-tech ops (SYNC-13) | Queued ops from a technician unassigned while offline are kept, stored, and flagged `pending supervisor review`; supervisor decides. Never discarded. |
| D-003 | Variation approval | Every variation requires Director approval — no threshold. |
| D-004 | Labour rate source | Per-job `labourRate`, default SGD 90/hr, overridable. |
| D-005 | Interim branding | `tkmr-new.png` + marine palette; swap real brand kit later. |
| D-006 | JobStatusHistory.reason | First-class append-only column, mandatory for side transitions (JOSM-8); enforced at the service layer. |
| D-007 | Resume gating | Resume from ON_HOLD is supervisor-gated (OPS_SUPERVISOR/SYSTEM_ADMIN), not execution-owner. |
| D-008 | ID channel split | Online REST creates are server-issued (CONV-ID-1); offline `/sync/batch` creates honour the client-supplied id (CC-MOB-1). Not contradictory. |
| D-009 | User/Technician modeling | Single `User` table with `roles[]`. NO separate Technician entity — a technician is a `User` with `TECHNICIAN` in roles. |
| D-010 | Checklist item/response shape | `ChecklistItemDef {id,label,type,required,options?,unit?}`, type ∈ bool/text/number/select/photo; `ChecklistItemResult {itemId,value,photoOpId?,na?}`. Photo items exempt from the generic required/null-check. |
| D-011 | Labour-rate snapshot timing | `WorkLog.labourRate` is snapshotted from `JobOrder.labourRate` at CREATE time, never re-resolved (OD-03). Invoicing sums from the snapshot, not the job's current rate. |
| D-012 | Sync delta cursor | ISO-timestamp accepted for Phase 1. MUST move to a monotonic `changeSeq` (bigserial) column before Phase 2 — timestamp collisions can silently drop rows (violates OD-04). |
| D-013 | BRANCH_SCOPE_DENIED semantics | Correct status for a sync op whose `jobOrderId` resolves outside the caller's branch/assignment — a sync op replays the device's own prior-legitimate cache. Distinct from REST's `NOT_FOUND` (which masks existence for live queries). |
| D-014 | DB-level audit immutability | Role `marinex_app` (blacklist-mutable: broad grant + targeted REVOKE). DB-enforced scope = `JobStatusHistory` + `AuditEntry` ONLY (unconditionally append-only). `Invoice`/`InvoiceLine` stay service-layer enforced (conditional on `issuedAt`). |
| D-015 | S0-9 script bug found + live-patched | `provision-app-role.sql`'s REVOKE was originally followed by later GRANT statements that silently re-granted the revoked privileges (Postgres: last statement wins). Fixed. |
| D-016 | S0-9 JobStatusHistory re-verified | Real-data retest confirmed enforcement on both immutable tables in the live container. |
| D-017 | S0-9/S0-7 end-to-end proof | **CLOSED.** AUDIT-3 (DB-level audit immutability) is now proven two ways: manual psql attempted-write tests AND an automated integration test (`jobOrders.int.test.ts`) that runs in CI going forward. |
| D-018 | P1-2/P1-3 integration-test gap | Branch scoping (P1-2) and CRM (P1-3) are unit-tested only — no DB-integration test exists yet, unlike P1-1/P1-5 (Job Orders). BE to add `branchScope.int.test.ts` and `crm.int.test.ts` before P1-2/P1-3 can be marked Done. **RESOLVED 2026-07-07 — both added, 94/94 tests passing.** |
| D-019 | Contact endpoint branch scoping | `Contact` has no `branch` column by design (can serve Clients across branches) — correct, do not add one. But `GET/PATCH /contacts/:id` must still scope non-cross-branch roles: accessible only if the Contact is `primaryContactId` for a Client in the caller's branch; `DIRECTOR`/`SYSTEM_ADMIN` (cross-branch roles) unrestricted. Returns `404 NOT_FOUND` otherwise — same masking convention as everywhere else. Implement via a join-based check at the service layer, not a schema change. **Ratified and implemented 2026-07-07 (BE), incl. tests.** Confirmed side effect: soft-deleting a Contact's only linking Client also removes REST access to that Contact — this is CORRECT and consistent with `Client` itself already returning 404 via REST once soft-deleted (SOFTDEL-1); not a gap. A cross-entity historical/archive lookup view, if ever needed, would be a separate future feature, not a Contact-specific fix. |
| D-020 | Sync batch op-processing semantics (SYNC-06/07/10) | **SYNC-06:** ops within a `/sync/batch` array apply in order, **independently per-op** — NOT all-or-nothing. A dependent op that needs a failed op's result fails `VALIDATION_ERROR`; unrelated ops in the same batch still apply. **SYNC-07:** a `schemaVersion` below the server minimum rejects the WHOLE batch (`BATCH_REJECTED_SCHEMA`), queue preserved, upgrade signalled — never silently dropped, never auto-migrated. **SYNC-10:** if the refresh token expires/revokes mid-offline, the server returns `401`, the local queue is preserved, and the client re-authenticates then retries the same `opId`s (idempotent-safe) — the queue is NEVER dropped on auth failure. |
| D-021 | Variation decision immutability (VAR-7) | `Variation.status` is a terminal state machine: `PROPOSED -> APPROVED` or `PROPOSED -> REJECTED` only. Once decided (either outcome), it CANNOT be re-decided — a further approve/reject attempt returns `STATE_TRANSITION_INVALID` (the existing JOSM error code; no new code needed). Corrections require creating a NEW variation, not mutating an already-decided one. |
| D-022 | CI seed step + lint scope exclusions | CI needs its own `Seed database` step — a fresh runner has no residual data (unlike local dev machines after months of manual testing). ESLint excludes compiled artifacts and `apps/mobile`'s CommonJS spike scripts from TS/ESM linting; `no-explicit-any` downgraded to warn (tracked debt, ~15 files, not a blocker). |
| D-023 | Recovery-verify request shape (doc fix) | `POST /auth/totp/recovery/verify` actually requires `{ email, code, longLived? }` -> `{ access, refresh }`. The contract's earlier `{code}`-only listing was a DOCUMENTATION ERROR, not a behavior change — `email` is required because the caller has no valid session at this step (that's the point of recovery). BE's implementation is correct as-is; only `INTERFACE_CONTRACT.md` needed correcting. |
| D-024 | Structured validation-error details | Every field-specific `VALIDATION_ERROR` MUST include `details: { field: string; reason: string }` in the error body (in addition to the human-readable `message`), so clients can branch on `details.field`/`details.reason` instead of string-matching `message`. First concrete case: duplicate IMO on vessel create returns `details: { field: "imoNumber", reason: "duplicate" }`. Applies going forward to all new field-specific validation errors, not just this one. |
| D-025 | EXEC-1 — web vs mobile transition UI | The JOSM gate type IS the mobile/web boundary. `execOwner`-gated transitions (`SCHEDULED->IN_PROGRESS`, `IN_PROGRESS->PENDING_REVIEW`) are field-technician actions under OD-04 — web shows these as READ-ONLY status, no action button (mobile owns them). `roles`-gated transitions (`DRAFT->SCHEDULED`, `PENDING_REVIEW->COMPLETED`, the rejection arrow, `ON_HOLD` entry/resume, `CANCELLED`) are office/supervisor actions — web shows these as active buttons, gated by role exactly as the backend enforces. Assignment/dispatch is unaffected (clearly an office action). |
| D-026 | GATE-1 — who may cancel a JO from DRAFT | Confirmed: `OPS_SUPERVISOR`, `SYSTEM_ADMIN`, `DIRECTOR` may cancel from any state where CANCELLED is legal (DRAFT/SCHEDULED/IN_PROGRESS/PENDING_REVIEW, per ADR-2). Matches BE's already-coded default — no change. |
| D-027 | Supervisor review-queue screen — timing | Deferred to Phase 2, not part of P1-8. The `PENDING_SUPERVISOR_REVIEW` queue (SYNC-13) only gets populated by real offline sync from an unassigned technician — that data doesn't exist until Phase 2's real field sync is live. Build alongside the Phase 2 mobile/roster work, not against an empty Phase-1 state. |
| D-028 | Design-token file delivery gap (visual regression) | The real `marinex360-design-tokens.css` was never copied into the repo — a placeholder sat in its place since S0-4, and `app.css` referenced CSS custom-property names that didn't exist in the real token file, silently dropped by the browser (no build/typecheck error). Fixed: real token file supplied, `app.css` variable names corrected via mapping table. LESSON: CI (typecheck/build) cannot catch CSS custom-property mismatches — only visual QA does; confirm asset files actually landed, not just that referencing code compiles. |
| D-029 | `GET /api/v1/vessels` list endpoint (scope gap) | Approved and specified: flat, branch-scoped list mirroring `GET /clients`, PLUS an optional `?clientId=` query filter (same underlying query, cheap to add now). Branch scoping via the owning `Client.branch` — same join pattern as D-019/P1-4's service-history scoping; non-cross-branch callers only see vessels whose Client is in their branch, `DIRECTOR`/`SYSTEM_ADMIN` see all. Unpaginated for Phase 1, matching `GET /clients`'s current behavior — do not introduce pagination on one list endpoint and not the other. |
| D-030 | Authenticated layout used `<slot/>` instead of `<RouterView/>` | `AppLayout.vue` rendered `<slot/>` in its main workspace instead of a nested `<RouterView/>`, so authenticated child routes (`/clients`, `/vessels`, `/job-orders`) never mounted — no page component, no store `onMounted()` loader, ZERO API calls. Fixed by nesting `<RouterView/>`; added visible retry actions to the three list error states. No API/auth/schema/scoping change. DIAGNOSTIC LESSON: zero fetch/xhr in the Network tab = a mount/routing problem, not a data problem — look at the layout/router, not the data code. |
| D-031 | OD-07 sequencing — multi-currency deferred within Phase 3 | FR-44 (true multi-currency/FX conversion) is "Should Have," not "Must Have" — none of FR-40/41/42/43 require it. Phase 3 MVP ships single-currency invoicing: Invoice.currency defaults to the operating branch's local currency, no conversion logic. True multi-currency (client billed in a different currency) is a LATER P3 increment, not a kickoff blocker. Mechanism ratified for when it's built: manual FX rate table (no external API, D-001 local-first), Finance-maintained, rate snapshotted onto the Invoice at DRAFT-creation, locked permanently once `issuedAt` is set (same pattern as D-011). |
| D-032 | OD-09 scope — Phase 3 MVP is SG GST only | Schema already reflects this (`gstAmountMinor`/`gstCurrency` are GST-named, not generic tax fields) and FR-41 explicitly says "Singapore GST compliance." MY (SST) / ID (PPN) / BD (VAT) have no schema fields yet — real gap, out of MVP scope, not invented or papered over. The exact SG GST rate/percentage must come from PM/Finance — TL will not invent a compliance number. |
| D-033 | Placeholder SG GST rate (unblocks P3-1/P3-3) | Interim placeholder rate: **9%**, PM-approved as a stand-in only — NOT verified against current IRAS regulations. Same pattern as D-004 (labourRate placeholder). MUST be implemented as a single configurable value (e.g. a `TaxRate`/config table row or env-level constant), never hardcoded inline in calculation logic, so the real verified rate is a one-line/config change later, not a code change. Flagged TODO-GST-RATE until PM/Finance confirms the real figure. |
| D-034 | Invoice.dueAt (schema gap for FR-42 OVERDUE) — CORRECTED | `Invoice` had no due-date field; added `dueAt DateTime?`, computed at the DRAFT->SENT (issue) transition as `issuedAt + N days`. N parsed from `Client.creditTerms` via pattern `/^NET(\d+)$/i` (matches "NET30"/"net45" etc.); if null/empty/non-matching, silently default to 30 days — never block issuing over an unrelated data-quality problem. CORRECTED: OVERDUE is STORED-STATUS-ONLY (Invoice.status is the single source of truth, same as JOSM) — a scheduled BullMQ job flips SENT/PARTIAL rows past dueAt to OVERDUE and fires the FR-42/FR-60 Notification. There is NO separate computed-on-read override (an earlier draft of this decision wrongly implied dual computation — corrected here after BE caught the ambiguity). |
| D-035 | P3-2 full invoice lifecycle + Payment model (CC-12) | New immutable `Payment` model (id, invoiceId, amountMinor [negative=reversal], currency, paidAt, recordedById, method?, reference?) — extends D-014's DB-level immutability (marinex_app REVOKE) to include Payment. Recording a payment = insert a Payment row, then in the same transaction recompute sum(amountMinor) for the invoice and write the derived status: sum=0->SENT, 0<sum<total->PARTIAL, sum>=total->PAID (SENT can jump straight to PAID, no forced PARTIAL). Corrections = a new reversing Payment row, never edit/delete (same pattern as D-021). Transitions: DRAFT->SENT (issue) = FINANCE via existing invoice:issue, freezes lines/totals (OD-03), sets issuedAt+dueAt, triggers PDF(P3-3)+email(P3-6). Payment recording = FINANCE/SYSTEM_ADMIN/DIRECTOR. ->OVERDUE = automatic only (BullMQ), never manual. |
| D-036 | apps/worker test infrastructure | Worker integration tests gated behind `RUN_WORKER_TESTS=1`, run against real local Redis (not mocked) with a dedicated test queue prefix, drained after each run. Same philosophy as `RUN_DB_TESTS=1` — test against the real thing, not a mock. |
| D-037 | Invoice.pdfObjectKey (CC-13) — schema gap for P3-3, narrow frozen-record exception | `Invoice` had no field to store the async-generated PDF's location. Added `pdfObjectKey String?`, nullable (null until the BullMQ worker job completes). This is the ONE deliberate, narrow exception to "frozen after issue" (OD-03) — every other field (lines, totals, billTo*) stays immutable post-issue; only pdfObjectKey is written once, by the worker job, on generation completion. Not a general loophole — do not extend this exception to any other field without a new ruling. P3-3 spec: trigger = enqueue BullMQ job from the issue route after the freeze transaction commits (never render synchronously in the HTTP request); invoiceNumber reuses the already-implemented {BRANCH}-{YYYY}-{NNNN} scheme (JONUM-1) — do not reinvent; template per MarineX360_Design_System_S0-4.md §6.1; bank details = single config value (env var), SG-only MVP scope; storage path `invoices/{invoiceId}/{invoiceNumber}.pdf` via the existing packages/storage adapter; tests assert enqueue-on-issue, pdfObjectKey written on job completion (RUN_WORKER_TESTS=1), %PDF magic-byte header (not pixel diffing), and extracted-text assertions for invoiceNumber/gstAmountMinor/billToName. |
| D-038 | P3-3 verification gate — RUN_WORKER_TESTS=1 must run in CI before P3-3 is credited as verified | BE correctly self-surfaced that the Chromium-backed PDF integration test (enqueue-on-issue, %PDF header, extracted-text content assertions) has NEVER actually executed successfully anywhere — not locally (no Chromium in that environment), not in CI (ci.yml only builds the worker's Docker image, never runs tests against it). Ruling: PDF generation is the actual client-facing deliverable of P3-3, not an edge case — "assertions exist and look correct" is not accepted as equivalent to "proven to pass," same standard held for every other slice this build. OPS to add a CI step running RUN_WORKER_TESTS=1 against the worker's own Docker image (Chromium already present, no new infra needed). P3-3 stays "In Review," not "Done," until that step exists and passes. Architecture lean (provisional, pending BE handing OPS the actual test file): install Chromium directly on the CI runner and run as a normal test step, matching how RUN_DB_TESTS=1 already runs against a real Postgres service container in-job, rather than testing inside a pruned production Docker image. |
| D-039 | CI build-order gap — packages/storage typechecked before being built | `packages/storage` compiles src/->dist/ (gitignored); its package.json points consumers at dist/. CI's Typecheck step ran on a fresh checkout where dist/ didn't exist yet — latent since the package was created, first triggered when P3-3's generateInvoicePdf.ts became the first typechecked code to import it. Fix: added a "Build storage package" step immediately before Typecheck in ci.yml. Verified by reproducing the failure locally (rm -rf dist -> typecheck fails identically to the CI log) before confirming the fix resolves it — not just asserted. Folded into the debugging-principles callout as lesson #4 (any workspace package shipping compiled output must be explicitly built in CI before anything that might import it is typechecked). |
| D-040 | D-038 CLOSED — RUN_WORKER_TESTS=1 verified green in real CI | Chromium installed on the CI runner (matching the RUN_DB_TESTS=1 pattern of real dependencies in-job, per D-038's architecture lean); Docker layer-ordering regression (from an earlier postinstall fix approved without checking against the Dockerfiles' manifests-first caching) fixed via --ignore-scripts on the early npm ci; MinIO bucket-step credential env-var mismatch fixed (S3_ACCESS_KEY_ID vs AWS CLI's expected var) and a masking `\|\| true` removed. generateInvoicePdf.int.test.ts now passes in CI end-to-end: real Chromium render -> real S3/MinIO upload -> real pdf-parse read-back with correct text extraction. Verified via the actual GitHub Actions run (not a local reproduction claim) — P3-3 moves to Done. |
| D-041 | Certificate.deletedAt (soft-delete gap) | `Certificate` was missing the soft-delete field every other entity has. Added `deletedAt DateTime?`. Matches existing pattern exactly, no ambiguity. |
| D-042 | Certificate.alertedAt (expiry-alert dedup) | Added `alertedAt DateTime?`. A certificate's approach to expiry isn't a one-way status transition like Invoice/OVERDUE — without an explicit marker, the reconciliation job would re-alert every run once past threshold. MVP: alert ONCE when `expiresAt <= now()+30days AND alertedAt IS NULL`, then set `alertedAt`. Graduated/repeated alerts (30-day, 7-day, post-expiry escalation) are a real future enhancement — flagged, not built now. Chose a direct structural field over querying Notification history, for the same reason `dueAt`/`issuedAt` are direct fields rather than derived. |
| D-043 | Certificate ownerType branch scoping (TECHNICIAN vs COMPANY) | TECHNICIAN-type Certificates scope via `User.branch` (join, same D-019 pattern) — no schema change needed. COMPANY-type Certificates are NOT branch-scoped at all — visible to any authenticated role with `certificate:read` regardless of branch, since TKMR is a single legal entity with operational branches (not separate subsidiaries), so a company-wide cert genuinely isn't branch-specific. A future per-branch company-cert case (e.g. local business registration) would be a separate refinement, not invented now. |
| D-044 | `officeRoles` must include DIRECTOR (web role-gate bug) | WEB found `officeRoles = ['OPS_SUPERVISOR','SYSTEM_ADMIN']` silently excludes DIRECTOR from 6 legal transitions (DRAFT->SCHEDULED, PENDING_REVIEW->COMPLETED, PENDING_REVIEW->IN_PROGRESS reject, SCHEDULED/IN_PROGRESS->ON_HOLD, both ON_HOLD-> resume paths). Ruling: add DIRECTOR to `officeRoles` for ALL 6 uniformly — Director has consistently held equal-or-greater authority than Ops Supervisor everywhere else (cross-branch access, D-026 cancel), and no ratified decision excludes Director from any of these 6. NOT the same shape as D-003 (variation approval is deliberately Director-EXCLUSIVE, a reserved power, not a floor/ceiling case) — these 6 are ordinary office-control actions with no basis for exclusion. Also CLARIFIES D-007: `ON_HOLD` resume's "supervisor-gated" set explicitly includes DIRECTOR (D-007 was silent on this, same omission shape, closed proactively). |

## Contract changes (CC-###) — ratified into INTERFACE_CONTRACT v1.1

| ID | Change |
| --- | --- |
| CC-1 | `JobOrder.executionOwnerId` — single execution owner (OD-05). |
| CC-2 | `Invoice.lines: InvoiceLine[]` — frozen lines including labour, replacing live `MaterialLine[]`. |
| CC-3 | `JobOrder.labourRate` — per-job, service-layer defaults SGD 90/hr (D-004). |
| CC-4 | User/Technician (single-table, D-009), TOTP enrolment endpoints, checklist template/item/response schema. |
| CC-5 | Sync per-op result enum (8 statuses incl. `APPLIED_FLAGGED`, `BRANCH_SCOPE_DENIED`, `STATE_TRANSITION_INVALID`); `ProcessedOp` keyed on `opId`. |
| CC-6 | `JobStatusHistory.reason` (D-006). |
| CC-7 | `buildApp({prisma, accessSecret, presignPut})` canonical signature — **still OPEN, pending PM ratification.** |
| CC-9 | `WorkLog.labourRateAmountMinor/Currency` — snapshotted at creation (D-011). |
| CC-10 | `GET /api/v1/vessels` — new branch-scoped list endpoint (optional `?clientId=` filter), unpaginated. Purely additive; no existing shape changed (D-029). |
| CC-11 | `Invoice.dueAt` — new nullable DateTime field, computed at issue time. Purely additive; no existing shape changed (D-034). |
| CC-12 | New `Payment` model — immutable payment ledger backing Invoice PARTIAL/PAID status, extends D-014 DB-immutability. Purely additive (D-035). |
| CC-13 | `Invoice.pdfObjectKey` — new nullable String field, written once by the async PDF worker job (narrow, deliberate exception to post-issue freeze). Purely additive (D-037). |
| CC-14 | `Certificate.deletedAt` — new nullable DateTime, matches existing soft-delete pattern. Purely additive (D-041). |
| CC-15 | `Certificate.alertedAt` — new nullable DateTime, expiry-alert dedup marker. Purely additive (D-042). |
| CC-MOB-1 | Offline creates carry a client-generated row id; `resultRef == payload.id` (D-008). |
| CC-MOB-2 | `APPLIED_FLAGGED` sync status + `reviewState` for SYNC-13 (D-002). |

## Still OPEN — do not assume, flag instead

- **OD-06** — e-signature evidence bundle (signer name, timestamp, device, geo, document hash). Mobile confirmed offline feasibility; awaiting PM ratification.
- **OD-07** — multi-currency FX rate source. Representation (minor units + ISO code) is fixed; the rate source is not.
- **OD-08** — client-portal external auth (Phase 6). Threat model required first.
- **CC-7** — `buildApp()` dependency signature, pending PM ratification.
- Also open in the PM Ratification Queue: JONUM-1 (number format), MFA-1 (MFA bootstrap flow), TTL-1 (refresh TTLs), GATE-1 (who may cancel from DRAFT), OD-09 (per-branch tax model).

---
*This file is generated from the workbook's Decision Log + Contract Changes sheets. Do not
edit by hand — request updates through the PM.*