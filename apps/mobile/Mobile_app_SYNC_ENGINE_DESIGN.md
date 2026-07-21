# MarineX360 — Offline Sync Engine Design (S0-6 spike)

**Owner:** Mobile · **Reviewer:** Tech Lead · **Harness:** QA sync-simulation
**Builds to:** OD-04, OD-05, SYNC-13 · INTERFACE_CONTRACT v1.0 §1/§4/ADR-3 ·
`schema.prisma` · SYSTEM_DESIGN_MODELS §6 (diagram is the build reference) ·
SRS §7.4 (FR-22…30), NFR-09 · UX Design System §3–4 (`<SyncStatusChip>`)
**Status:** spike for ratification — contains 1 proposed contract change (CC-MOB-1) and
1 proposed status-enum addition (CC-MOB-2) that the engine *needs*; flagged, not assumed.

---

## 1. Scope & the one property that makes this tractable

The technician only ever authors **child rows of a Job Order that already exists on the
server** (OD-02 starts the pipeline office-side; OD-04 pre-fetches the JO). Offline writes
are limited to: `WorkLog`, `Photo`, `Observation`, `ChecklistInstance`, `MaterialLine`,
`ESignature` — all carrying a `jobOrderId` that was pre-fetched. **There are no
offline-created parents.** Consequence: no client-temp-id → server-id remapping graph is
needed; each op is independent except for the photo/signature binary-before-metadata
ordering. This is the single biggest risk reducer and I am stating it explicitly so the TL
can confirm it holds for Phase 2 (it breaks only if we ever let a technician create a JO
offline — which OD-02/OD-04 say we do not).

## 2. The four sub-systems

```
 ┌─────────────┐   author    ┌──────────────┐   drain    ┌──────────────┐
 │ Field UI    │ ──────────▶ │  op_queue    │ ─────────▶ │ Sync Engine  │
 │ (SQLite     │  (1 txn:    │  (+ entity   │            │ (push/pull,  │
 │  reads)     │  row+op)    │   tables)    │ ◀───────── │  backoff)    │
 └─────────────┘             └──────────────┘  reconcile └──────┬───────┘
        ▲                                                       │ HTTP
        │ <SyncStatusChip> reads sync_state                     ▼
   binary_upload (S3 presigned PUT, two-phase) ───────▶  /sync/batch · /sync/assigned
```

1. **Authoring** — a user action writes the entity row *and* appends one `op_queue` row in a
   single SQLite transaction, so the queue can never diverge from what the UI shows. Row
   `sync_state = PENDING`. Multi-row actions (e.g. "complete job" → checklist + signature)
   enqueue multiple ops; order is preserved by `op_queue.seq`.
2. **Binary upload** (`binary_upload`) — photos and the signature image cannot ride in JSON.
   On reconnect they upload to S3 first via a presigned PUT; the resulting `s3Key` is patched
   into the metadata op, which `blocks_on` the upload until then.
3. **Sync engine** — drains the queue: pushes a `/sync/batch`, applies per-op results, then
   pulls `/sync/assigned?since=<cursor>`.
4. **Read cache** — pre-fetched JO/checklist/document rows the UI reads offline.

## 3. Authoring an op (offline)

```
op = {
  opId:        uuid(),            // idempotency key (OD-04) — UNIQUE for all time
  entity:      'Observation',
  action:      'CREATE',          // CREATE | UPDATE
  entityId:    uuid(),            // client-generated row UUID  (CC-MOB-1)
  jobOrderId:  '<prefetched JO>',
  payload:     { ...row fields..., opId, id: entityId },
  baseVersion: null,              // for UPDATE: the version we loaded (OD-05)
  schemaVersion: app_meta.schema_version,
  clientTime:  ISO,
}
```

- `opId` and `entityId` are generated with a UUIDv4 source available offline (no server round
  trip). They are stable across retries → the same bytes are resent on every attempt.
- For an **UPDATE**, `baseVersion` is the `version` of the row we loaded. This is what the
  server compares for OD-05 optimistic concurrency.
- The op is immutable once enqueued, *except* `payload.s3Key` patched in after binary upload,
  and the retry/backoff bookkeeping columns.

## 4. The push: `POST /sync/batch`

Request (exactly the contract shape):
```
{ schemaVersion: <int>, ops: [ {opId, entity, action, entityId, jobOrderId, payload, baseVersion}, ... ] }
```

We batch up to N ready ops (`status=PENDING` AND `next_attempt_at` passed AND not blocked),
ordered by `seq`. The whole request is safe to resend because every op is idempotent.

### 4.1 Batch-level outcome
- **Network failure / timeout** → nothing changes server-side we can rely on, but every op is
  idempotent, so we simply retry the whole batch under backoff (§6). Queue preserved.
- **`401 UNAUTHORIZED`** (refresh token expired/revoked mid-offline) → **pause**, preserve the
  queue untouched, run the biometric/PIN re-auth → refresh-rotation flow, then **retry the
  exact same opIds**. The queue is *never* dropped on auth failure. (Contract §1 / sync rule.)
- **`BATCH_REJECTED_SCHEMA`** (our `schemaVersion` < server minimum) → the **entire batch is
  rejected**, the local queue is **preserved**, and we raise an *"Update required"* gate that
  blocks further sync until the app is upgraded. We **never auto-migrate** payloads and
  **never drop** ops. (Contract sync rule.)

### 4.2 Per-op result (contract shape)
```
{ opId, status, resultRef?, serverVersion?, error? }
status ∈ { APPLIED, IDEMPOTENT_REPLAY, VERSION_CONFLICT,
           VALIDATION_ERROR, FORBIDDEN, BATCH_REJECTED_SCHEMA }
```

Disposition table (this is the heart of the engine):

| status | queue row | entity `sync_state` | retry? | UI (`<SyncStatusChip>`) |
|---|---|---|---|---|
| `APPLIED` | mark SYNCED, store `server_version`,`result_ref` | SYNCED (bump version) | no | **Synced** |
| `IDEMPOTENT_REPLAY` | mark SYNCED (server already had it) | SYNCED | no | **Synced** |
| `VERSION_CONFLICT` | mark CONFLICT, keep op | CONFLICT | **reload+reapply** (§5) then re-queue | **Retry needed** → reconcile view |
| `VALIDATION_ERROR` | mark ERROR, **do not blind-retry** | ERROR | no (needs user/dev fix) | **Retry needed** (tap shows reason) |
| `FORBIDDEN` | mark ERROR, surface | ERROR | no | **Retry needed** (tap shows reason) |
| `APPLIED_FLAGGED` *(CC-MOB-2, SYNC-13)* | mark SYNCED+FLAGGED, store refs | FLAGGED | no | **Sent — pending review** |
| `BATCH_REJECTED_SCHEMA` (per-op echo) | leave PENDING | PENDING | yes after upgrade | unchanged (queued) |

`IDEMPOTENT_REPLAY → Synced` (not an error) is exactly what UX §3 requires.

## 5. Conflict handling (OD-05, no pessimistic locks)

On `VERSION_CONFLICT` we follow diagram-6's path rather than bloating the per-op result:
1. The op stays in the queue as `CONFLICT`; its entity row chip goes to **Retry needed**.
2. The engine runs the trailing `GET /sync/assigned?since=<cursor>` (§7), which returns the
   fresh server row + new `version`.
3. The device re-stages the technician's field edits onto the fresh row (UX §4 reconcile
   view shows *their values vs server values* for a one-tap confirm), sets the op's
   `baseVersion` to the new server version, and flips it back to `PENDING`.
4. Re-push. Because single-owner assignment (OD-05) + header-lock-at-IN_PROGRESS keep two
   writers off the same execution row, this path is rare by design — but it is correct when
   it fires (e.g. an admin edited a material line office-side).

We **never** discard the technician's input on conflict.

## 6. Retry / backoff

- **Trigger to attempt sync:** connectivity-regained event, app foreground, manual "Sync now",
  and a periodic timer while online.
- **Backoff:** per-op `attempts`-driven exponential delay with full jitter:
  `delay = min(cap, base * 2^attempts) * rand(0.5..1.0)`, `base=2s`, `cap=5min`. Stored in
  `next_attempt_at`; an op is only eligible when that time passes.
- **Backoff applies to retryable outcomes only**: network/5xx (batch) and `VERSION_CONFLICT`
  (after reconcile). `VALIDATION_ERROR`/`FORBIDDEN` are **not** auto-retried — they would loop;
  they wait for a user action or a fix. `BATCH_REJECTED_SCHEMA` waits for app upgrade.
- A **circuit note** in the global header (`N queued`, worst-case colour per UX §3) tells the
  tech there is unsent work before they leave Wi-Fi.

## 7. The pull: `GET /sync/assigned?since=<cursor>`

- Returns the delta of **the owner's jobs + their documents/checklists** since the cursor
  (server enforces owner scope — OD-04 guardrail; the device never asks for other jobs).
- We persist rows into the read cache, advance `sync_cursor.cursor`, and cache document
  binaries for offline view.
- Pull runs: after a successful push (to learn server-side changes), to resolve conflicts
  (§5), and on a schedule while online.
- **Guardrail honoured:** newly-updated *other* jobs, ad-hoc downloads, and submission all
  require connectivity (OD-04). The cache only ever contains the technician's own assigned set.

## 8. OD-06 feasibility finding (driving to closure)

The TL's proposed e-signature evidence bundle (signerName, signerRole, signedAt, deviceId,
geo, documentHash = SHA-256 of the signed report PDF) is **feasible to capture fully offline**:
- `deviceId` — stable per-install id from secure storage (Capacitor `Device.getId()` +
  a value we persist in the Keychain/Keystore). Available with no connectivity.
- `geo` — `Geolocation.getCurrentPosition()` works offline from GNSS; we capture lat/lng at
  signing and tolerate a null (open sky not guaranteed inside a hull) — store null, don't block.
- `signedAt` — device clock (UTC), same trust level as every other offline timestamp.
- `documentHash` — we compile the completion-report PDF **on-device** at sign time and hash
  the exact bytes the signer saw, so the hash binds to what was signed even before upload.

**Recommendation to PM:** adopt the bundle as specified; Mobile can deliver all five fields
offline. Only ratification (and the `ESignature` columns already reserved in schema.prisma)
is outstanding. Until ratified, the engine writes the image-only fallback and leaves the
evidence columns null.

## 8b. D-004 — labourRate snapshotting (closed this session)

`labourRate` is per-job (default SGD 90/hr, overridable office-side). A `WorkLog` authored
offline snapshots the JO's current `labourRateAmountMinor`/`labourRateCurrency` from
`jo_cache` **at authoring time** and writes it onto the row. If the office later changes the
JO's rate, that only updates `jo_cache` for the *next* worklog — it never rewrites an
already-authored/synced `WorkLog`, consistent with OD-03 (operational records immutable).
Verified in prototype scenario 9.

## 9. What the engine deliberately does NOT do

- No pessimistic locks, no offline JO creation, no stock logic (OD-01), no FX conversion
  (OD-07 open), no direct DB access (all via documented API), no silent drops, no auto-migrate.

---

## CONTRACT CHANGES the engine needs (proposed — PM/TL to ratify)

- **CC-MOB-1 — client-generated entity `id` on offline create ops.** Offline create ops carry
  a client-generated row UUID `id` (alongside `opId`); the server persists with that id so
  `resultRef == payload.id`. Removes temp-id remapping and lets the device reference a row
  (photo binary, later edits) before sync. *If TL prefers server-assigned ids, the engine must
  add an id-reconciliation pass — heavier; flagging the choice rather than assuming.*
- **CC-MOB-2 — SYNC-13 needs a per-op status the enum currently lacks.** SYNC-13 says ops from
  a now-unassigned technician are **accepted, stored, and flagged "pending supervisor review,"
  never discarded.** The contract per-op enum has only `FORBIDDEN` (= reject) and `APPLIED`
  (= silently normal) — neither expresses "accepted but flagged." Proposal: add
  **`APPLIED_FLAGGED`** (with `reviewState: 'PENDING_SUPERVISOR_REVIEW'`) so the device can
  show **"Sent — pending review"** and not treat it as an error. Needs BE (server marks the
  row) + Web (supervisor accept/reject queue).

## NEEDS from other roles (via PM)
- **BE** — confirm the per-op result enum and ratify `APPLIED_FLAGGED` (CC-MOB-2); confirm
  CC-MOB-1; provide a **presigned-S3-PUT endpoint** (or upload proxy) for offline binaries
  (photos, signature image) so `/sync/batch` carries only metadata + resulting `s3Key`;
  confirm `GET /sync/assigned` cursor format + payload schema.
- **TL** — confirm the "no offline-created parents" invariant for Phase 2; ratify checklist
  item/response schema (G-4) so `ChecklistInstance.results_json` shape is fixed.
- **QA** — the disposition table in §4.2 is the oracle your sync-simulation harness should
  assert against; the prototype emits machine-readable results for it.