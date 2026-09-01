# ACCEPTANCE_CRITERIA v0.4 — P2-7 Mobile Sync

**Scope:** P2-7 (Mobile QA). Operationalizes D-062 (technician-facing chip/panel copy for
CC-5's 11-status OpStatus union) as executable Maestro scenarios, per NFR-09, OD-04/OD-05,
CC-5, D-002/D-013/D-054/D-061.

**Device lifecycle states:** SYNCED | PENDING | SYNCING | CONFLICT | ERROR | FLAGGED.
Queued work is preserved through network/auth/schema failures (never silently dropped).

## MAE-CHIP-1…9

| ID | Scenario | Asserts |
| --- | --- | --- |
| MAE-CHIP-1 | Clean offline observation → reconnect | Chip sequence exactly Queued → Sending… → Synced; no intermediate flicker to an error state |
| MAE-CHIP-2 | Materials added by a now-unassigned technician, offline, then synced | Chip = Sent (pending review), never Synced alone and never an error color |
| MAE-CHIP-3 | Office closes the JO while technician has a queued worklog offline | On sync, chip = Job status changed with detail "the job changed while you were offline" — must NOT show Retry needed and must NOT auto-retry |
| MAE-CHIP-4 | Technician's branch/assignment scope is revoked mid-offline-session | Chip = Job access changed with detail "contact your supervisor" — must NOT show Retry needed |
| MAE-CHIP-5 | A cached job record becomes unavailable server-side before sync | Chip = Job or record unavailable with detail "saved work is still on this device"; the local row is not deleted from the device |
| MAE-CHIP-6 | VERSION_CONFLICT on a queued op | Chip = Retry needed, tapping opens the reconcile view (distinct from 3/4/5, which must never offer reconcile/retry) |
| MAE-CHIP-7 | Global header aggregate mixing pending + one non-retryable error | Aggregate shows worst-case state (error-family > pending > syncing > synced); tapping surfaces specific per-item labels, not "N errors" |
| MAE-CHIP-8 (accessibility) | Any error-family chip, color-simulation / no-color mode | Icon + text alone still distinguish all states — never color-alone |
| MAE-CHIP-9 (detail area) | Any error-family chip | Expandable detail area reveals the technical status code for support/QA, not shown as primary UI |

**Defect severity:** MAE-CHIP-3/4/5 rendering as generic "Retry needed" = **S2, not cosmetic**
(D-062's own rationale — misleading, not imprecise).

## Finalized technician vocabulary (D-062)

Queued → Sending… → Synced → Sent (pending review) → Retry needed → Job/record unavailable /
Job access changed / Job status changed.

- **VERSION_CONFLICT** → "Retry needed" (OD-05's reload-and-reapply is a genuine retry path)
- **VALIDATION_ERROR** → "Retry needed" when technician correction is possible
- **FORBIDDEN** → uses the server error reason where available, not a generic retry prompt
- **NOT_FOUND / BRANCH_SCOPE_DENIED / STATE_TRANSITION_INVALID** → distinct, honest copy per
  the table above — never a generic retry prompt (D-062)

## Visual rules (reinforces S0-4's design system, not new)

Never color-alone; icon + text always; minimum 44px interactive targets; glare-readable for
deck conditions; underlying technical code available in an expandable detail area for
support/QA, never as primary UI.

## Execution status

**BLOCKED as of 2026-08-31** — Android device/emulator access not yet provisioned. Do not
report P2-7 as executed/on-track until MAE-CHIP-1…9 have run against a real device/emulator,
not the Node test harness (D-061 lesson).