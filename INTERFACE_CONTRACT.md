# MarineX360 Interface Contract

This is the first git-tracked `INTERFACE_CONTRACT.md`.

Source of truth for shapes in this file:

- API routes: `apps/api/src/routes/*.ts`
- RBAC matrix: `apps/api/src/domain/rbac.ts`
- Error envelope: `apps/api/src/lib/errors.ts`, `apps/api/src/plugins/errorHandler.ts`, `apps/web/src/lib/api/errors.ts`
- Data models: `prisma/schema.prisma`
- Decision context only: `RESOLVED_DECISIONS.md`

Where live source and `RESOLVED_DECISIONS.md` disagree, live source is documented here and the disagreement is listed in [OPEN DISCREPANCIES](#open-discrepancies).

## 1. Overview

MarineX360 is a single-tenant, branch-scoped field-service system. Operational access is enforced in the API service layer, not in UI-only checks. Branch scope comes from the verified access token, never from client-supplied request data. Non-cross-branch roles are pinned to `ctx.branch`; `SYSTEM_ADMIN` and `DIRECTOR` are cross-branch roles. Direct-ID cross-branch reads/writes are masked as `NOT_FOUND`. List endpoints return only in-scope rows, usually as empty arrays for out-of-scope filters. [OD-03, OD-04, OD-05, D-019, D-029]

The main workflow starts at a Job Order: create DRAFT JO, schedule/assign, execute in the field, submit for review, complete, auto-generate a DRAFT invoice, issue invoice, record payments, and reconcile overdue invoices asynchronously. Materials are record-keeping only; no stock deduction/reservation appears in the live API. [OD-01, OD-02, OD-03, D-003, D-035]

Offline writes use `/api/v1/sync/batch`. Online REST creates use server-issued ids, while offline creates may supply client UUID row ids and use `opId` for idempotency. [D-008, CC-MOB-1]

## 2. Types

### User And Auth Types

Roles from `apps/api/src/domain/rbac.ts`:

```ts
export type Role = 'SYSTEM_ADMIN' | 'DIRECTOR' | 'FINANCE' | 'OPS_SUPERVISOR' | 'TECHNICIAN';
export const ALL_ROLES: Role[] = ['SYSTEM_ADMIN', 'DIRECTOR', 'FINANCE', 'OPS_SUPERVISOR', 'TECHNICIAN'];
```

Access claims from `apps/api/src/auth/tokens.ts`:

```ts
export interface AccessClaims { sub: string; roles: Role[]; branch: string; mfaComplete?: boolean; iat: number; exp: number; }
```

### Money

From `apps/api/src/lib/money.ts`:

```ts
export interface Money {
  amountMinor: number; // integer minor units (e.g. cents)
  currency: string;    // ISO-4217, e.g. "SGD"
}
```

Money fields in API shapes are represented as integer minor-unit columns plus ISO-4217 currency strings; no float money fields are used. [CONV-MONEY-1/2, D-031]

### OpStatus

There is no named `type OpStatus` in live source. The actual source definition is the `OpResult.status` union in `apps/api/src/routes/sync.ts`, composed from `OpApplyStatus` in `apps/api/src/services/idempotency.ts`, literal `'IDEMPOTENT_REPLAY'`, and `ErrorCode` in `apps/api/src/lib/errors.ts`.

Verbatim source snippets:

```ts
export type OpApplyStatus = 'APPLIED' | 'APPLIED_FLAGGED';
```

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID'
  | 'BATCH_REJECTED_SCHEMA';
```

```ts
interface OpResult {
  opId: string;
  status: OpApplyStatus | 'IDEMPOTENT_REPLAY' | ErrorCode;
  resultRef?: string;
  serverVersion?: number;
  reviewState?: string;
  error?: { code: string; message: string };
}
```

Effective status values from that live source union:

```text
APPLIED
APPLIED_FLAGGED
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
VERSION_CONFLICT
IDEMPOTENT_REPLAY
BRANCH_SCOPE_DENIED
STATE_TRANSITION_INVALID
BATCH_REJECTED_SCHEMA
```

### ApiError

Backend envelope from `apps/api/src/plugins/errorHandler.ts`:

```ts
{ error: { code: err.code, message: err.message, details: err.details } }
```

Unknown errors return:

```ts
{ error: { code: 'INTERNAL', message: 'internal error' } }
```

Frontend consumer shape from `apps/web/src/lib/api/errors.ts`:

```ts
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}
```

`ApiErrorCode` is:

```ts
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID'
  | 'BATCH_REJECTED_SCHEMA';
```

HTTP status mapping from `apps/api/src/lib/errors.ts`:

| Code | HTTP |
| --- | ---: |
| `VALIDATION_ERROR` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `VERSION_CONFLICT` | 409 |
| `IDEMPOTENT_REPLAY` | 200 |
| `BRANCH_SCOPE_DENIED` | 403 |
| `STATE_TRANSITION_INVALID` | 409 |
| `BATCH_REJECTED_SCHEMA` | 409 |

### Domain Models

The following Prisma model blocks are copied from `prisma/schema.prisma`.

```prisma
model User {
  id                String   @id @default(uuid())
  email             String   @unique
  name              String
  passwordHash      String
  roles             String[]
  branch            String
  designation       String?
  baseLocation      String?          // G-3
  skills            String[]         // G-3 technician skills
  available         Boolean  @default(true)  // G-3 roster availability
  totpSecret        String?          // active secret (NFR-07; enforced for admin/finance)
  totpPendingSecret String?          // set during enrolment, promoted on confirm (G-2)
  mfaEnrolled       Boolean  @default(false)
  recoveryCodes     String[]         // HASHED single-use recovery codes (G-2)
  active            Boolean  @default(true)
  version           Int      @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  refreshTokens     RefreshToken[]
  @@index([branch])
}
```

```prisma
model Contact {
  id String @id @default(uuid())
  name String
  email String?
  phone String?
  anonymised Boolean @default(false)
  version Int @default(0)
  clients Client[]
}
```

```prisma
model Client {
  id String @id @default(uuid())
  branch String
  name String
  address String?
  creditTerms String?
  status String @default("ACTIVE")
  primaryContact Contact? @relation(fields: [primaryContactId], references: [id])
  primaryContactId String?
  deletedAt DateTime?
  version Int @default(0)
  vessels Vessel[]
  @@index([branch])
}
```

```prisma
model Vessel {
  id String @id @default(uuid())
  client Client @relation(fields: [clientId], references: [id])
  clientId String
  imoNumber String @unique
  name String
  type String?
  flag String?
  classification String?
  deletedAt DateTime?
  version Int @default(0)
  @@index([clientId])
}
```

```prisma
model JobOrder {
  id                String   @id @default(uuid())
  joNumber          String   @unique
  branch            String
  clientId          String
  vesselId          String
  serviceCategories String[]
  port              String?
  scopeSummary      String
  origin            String  @default("MANUAL")   // JobOrigin (OD-02)
  externalQuoteRef  String?
  externalRfqRef    String?
  quotedAmountMinor Int                           // frozen baseline (OD-02)
  quotedCurrency    String
  labourRateAmountMinor Int?                       // CC-3 RATIFIED; service layer defaults 9000 (SGD 90.00/hr, D-004)
  labourRateCurrency    String? @default("SGD")
  state                 String  @default("DRAFT") // JobState (ADR-2 adjacency)
  assignedTechnicianIds String[]
  executionOwnerId      String?                    // CC-1 RATIFIED — single owner of execution data (OD-05)
  plannedStartDate DateTime?
  deletedAt        DateTime?
  version          Int       @default(0)
  createdBy        String
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  changeSeq        BigInt    @default(autoincrement())
  statusHistory JobStatusHistory[]
  materials     MaterialLine[]
  variations    Variation[]
  worklogs      WorkLog[]
  photos        Photo[]
  observations  Observation[]
  checklists    ChecklistInstance[]
  invoices      Invoice[]
  signature     ESignature?
  @@index([branch, state])
  @@index([clientId])
  @@index([vesselId])
  @@index([changeSeq])
}
```

```prisma
model JobStatusHistory {              // append-only + DB-immutable
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  fromState String
  toState String
  actorId String
  reason String?
  at DateTime @default(now())
  @@index([jobOrderId])
}
```

```prisma
model Variation {                     // D-003: EVERY variation needs Director approval (no threshold)
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  reason String
  amountMinor Int
  amountCurrency String
  status String @default("PROPOSED")  // PROPOSED -> APPROVED | REJECTED (Director only)
  approverId String?                  // must resolve to a Director role
  version Int @default(0)
  createdAt DateTime @default(now())
  lines MaterialLine[]
}
```

```prisma
model MaterialLine {
  id String @id @default(uuid())
  jobOrder JobOrder? @relation(fields: [jobOrderId], references: [id])
  jobOrderId String?
  variation Variation? @relation(fields: [variationId], references: [id])
  variationId String?
  partCatalog PartCatalog? @relation(fields: [partCatalogId], references: [id])
  partCatalogId String?
  description String
  quantity Decimal @db.Decimal(12,3)
  unit String
  unitCostAmountMinor Int
  unitCostCurrency String
  source String                        // OFFICE | FIELD
  addedById String
  opId String? @unique                 // offline idempotency (OD-04)
  reviewState String?                  // SYNC-13/D-002: null|PENDING_SUPERVISOR_REVIEW|ACCEPTED|REJECTED
  deletedAt DateTime?
  version Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  changeSeq BigInt @default(autoincrement())
  @@index([jobOrderId])
  @@index([changeSeq])
}
```

```prisma
model WorkLog {
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  technicianId String
  startedAt DateTime
  endedAt DateTime?
  labourRateAmountMinor Int? // CC-9: snapshotted from JobOrder.labourRate at CREATE time — never re-resolved.
  labourRateCurrency String? @default("SGD")
  opId String? @unique
  reviewState String?
  version Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  changeSeq BigInt @default(autoincrement())
  @@index([jobOrderId])
  @@index([changeSeq])
}
```

```prisma
model Invoice {
  id String @id @default(uuid())
  invoiceNumber String @unique
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  branch String
  status String @default("DRAFT")
  billToName String
  billToAddress String?
  billToEmail String? // CC-16/D-045: frozen from Client primary Contact email at DRAFT generation
  gstAmountMinor Int?
  gstCurrency String?
  totalAmountMinor Int
  totalCurrency String
  issuedAt DateTime?
  dueAt DateTime? // CC-11/D-034: computed at issue (DRAFT->SENT), issuedAt + N days
  pdfObjectKey String? // CC-13/D-037: the ONE narrow exception to post-issue freeze
  version Int @default(0)
  createdAt DateTime @default(now())
  lines InvoiceLine[]                  // CC-2 RATIFIED
  payments Payment[]                   // D-035/CC-12 immutable ledger rows
  @@index([branch, status])
}
```

```prisma
model InvoiceLine {                    // frozen at issue (OD-03)
  id String @id @default(uuid())
  invoice Invoice @relation(fields: [invoiceId], references: [id])
  invoiceId String
  kind String                          // LABOUR | MATERIAL | VARIATION | OTHER
  description String
  quantity Decimal @db.Decimal(12,3)
  unit String?
  unitPriceAmountMinor Int
  unitPriceCurrency String
  lineTotalAmountMinor Int
  lineTotalCurrency String
  @@index([invoiceId])
}
```

```prisma
model Payment {                        // D-035/CC-12: immutable ledger, extends D-014's DB-level immutability
  id           String   @id @default(uuid())
  invoice      Invoice  @relation(fields: [invoiceId], references: [id])
  invoiceId    String
  amountMinor  Int                      // negative = reversal (corrections never edit/delete, same pattern as D-021)
  currency     String
  paidAt       DateTime
  recordedById String
  method       String?
  reference    String?
  createdAt    DateTime @default(now())
  @@index([invoiceId])
}
```

```prisma
model Document {
  id String @id @default(uuid())
  ownerType String                     // JOB | VESSEL
  ownerId String
  s3Key String
  filename String
  mimeType String
  uploadedById String
  deletedAt DateTime?
  createdAt DateTime @default(now())
  @@index([ownerType, ownerId])
}
```

```prisma
model Certificate {                    // technician (G-3), vessel/company (FR-21/48)
  id String @id @default(uuid())
  ownerType String                     // TECHNICIAN | VESSEL | COMPANY
  ownerId String
  certType String
  identifier String?
  issuedAt DateTime?
  expiresAt DateTime
  s3Key String?
  deletedAt DateTime?                  // D-041: soft-delete, matches every other entity's pattern
  alertedAt DateTime?                  // D-042: direct dedup field for recurring expiry alerts
  version Int @default(0)
  @@index([ownerType, ownerId])
  @@index([expiresAt])
}
```

```prisma
model AuditEntry {                     // append-only + DB-immutable (QA Part-F)
  id String @id @default(uuid())
  entityType String
  entityId String
  action String
  actorId String
  at DateTime @default(now())
  diff Json?
  @@index([entityType, entityId])
  @@index([at])
}
```

Additional API/sync models used by current endpoints:

```prisma
model Photo {
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  s3Key String?                        // null until binary uploaded (two-phase presign)
  phase String                         // BEFORE | DURING | AFTER
  geoLat Float?
  geoLng Float?
  takenAt DateTime
  capturedById String
  opId String? @unique
  reviewState String?
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  changeSeq BigInt @default(autoincrement())
  @@index([jobOrderId])
  @@index([changeSeq])
}
```

```prisma
model Observation {
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  templateKey String?
  body String
  authorId String
  opId String? @unique
  reviewState String?
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  changeSeq BigInt @default(autoincrement())
  @@index([jobOrderId])
  @@index([changeSeq])
}
```

```prisma
model ChecklistTemplate {             // G-4 — items shape in INTERFACE_CONTRACT §2
  id String @id @default(uuid())
  name String
  serviceCategory String?
  jobType String?
  items Json
  active Boolean @default(true)
  version Int @default(0)
  instances ChecklistInstance[]
}
```

```prisma
model ChecklistInstance {             // G-4 — results shape in INTERFACE_CONTRACT §2
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String
  template ChecklistTemplate @relation(fields: [templateId], references: [id])
  templateId String
  results Json
  completedById String?
  completedAt DateTime?
  opId String? @unique
  reviewState String?
  version Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  changeSeq BigInt @default(autoincrement())
  @@index([jobOrderId])
  @@index([changeSeq])
}
```

```prisma
model ESignature {                    // OD-06 evidence RESERVED; Mobile confirmed offline feasibility (S0-6 §8)
  id String @id @default(uuid())
  jobOrder JobOrder @relation(fields: [jobOrderId], references: [id])
  jobOrderId String @unique
  imageS3Key String?
  signerName String?
  signerRole String?
  signedAt DateTime?
  deviceId String?
  geoLat Float?
  geoLng Float?
  documentHash String?                 // SHA-256 of signed completion PDF
  opId String? @unique
  reviewState String?
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  changeSeq BigInt @default(autoincrement())
  @@index([changeSeq])
}
```

```prisma
model ProcessedOp {                    // OD-04 idempotency registry, keyed on opId (QA Part-F)
  opId String @id
  entity String
  action String
  resultRef String?                    // == created row id (CC-MOB-1)
  status String                        // APPLIED | APPLIED_FLAGGED
  processedAt DateTime @default(now())
}
```

Checklist JSON shapes from `apps/api/src/domain/checklist.ts`:

```ts
export type ChecklistItemType = 'bool' | 'text' | 'number' | 'select' | 'photo';

export interface ChecklistItemDef {
  id: string;
  label: string;
  type: ChecklistItemType;
  required: boolean;
  options?: string[]; // 'select' only
  unit?: string;       // 'number' only
}

export interface ChecklistItemResult {
  itemId: string;
  value: boolean | string | number | null;
  photoOpId?: string; // links a 'photo' item to its Photo op (via opId)
  na?: boolean;        // "not applicable" override
}
```

Job Order states from `apps/api/src/domain/josm.ts`:

```ts
export type JoState =
  | 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'PENDING_REVIEW'
  | 'COMPLETED' | 'INVOICED' | 'CLOSED' | 'ON_HOLD' | 'CANCELLED';
```

## 3. Auth

All protected endpoints use `Authorization: Bearer <access>`. `authenticate` verifies the JWT and sets `req.ctx = { userId, roles, branch }`. Business routes generally also require `requireMfaEnrolled`; admin/finance tokens with incomplete MFA get `FORBIDDEN`. [NFR-07, RBAC-SPOOF-1]

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | Public | `{ email, password, totp?, longLived? }` | `{ access, refresh, mfaEnrollmentRequired }` | `VALIDATION_ERROR`, `UNAUTHORIZED` |
| POST | `/api/v1/auth/refresh` | Public | `{ refresh, longLived? }` | `{ access, refresh }` | `VALIDATION_ERROR`, `UNAUTHORIZED` |
| POST | `/api/v1/auth/totp/enroll` | `authenticate` | none required | `{ provisioningUri, secretMasked }` | `UNAUTHORIZED`, `NOT_FOUND` |
| POST | `/api/v1/auth/totp/enroll/confirm` | `authenticate` | `{ code }` | `{ recoveryCodes }` | `VALIDATION_ERROR`, `UNAUTHORIZED` |
| POST | `/api/v1/auth/totp/verify` | `authenticate` | `{ code }` | `{ ok: true }` | `UNAUTHORIZED` |
| POST | `/api/v1/auth/totp/recovery/verify` | Public | `{ email, code, longLived? }` | `{ access, refresh }` | `UNAUTHORIZED` |

Refresh-token rotation uses opaque refresh tokens, stores only hashes, revokes the whole family on reuse, and issues access tokens with about 15 minutes of TTL. Refresh TTLs in source are 30 days for web and 90 days for mobile. [OD-04, RBAC-JWT-1/2]

## 4. Endpoints

Common protected-endpoint errors:

- Missing/invalid/expired bearer token: `UNAUTHORIZED`.
- Missing required RBAC action or incomplete required MFA: `FORBIDDEN`.
- Unexpected server errors: `{ error: { code: 'INTERNAL', message: 'internal error' } }`.

### Health

The health route is registered in `apps/api/src/app.ts`, not under `apps/api/src/routes/*.ts`.

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/health` | Public | none | `{ status: 'ok', service: 'marinex360-api', time }` | `INTERNAL` only for unexpected errors |

### CRM

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/contacts` | `contact:write` | `{ name, email?, phone? }` | `Contact` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR` |
| GET | `/api/v1/contacts/:id` | `contact:read` | path `{ id }` | `Contact` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |
| PATCH | `/api/v1/contacts/:id` | `contact:write` | `{ version, name?, email?, phone? }` | `Contact` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT` |
| POST | `/api/v1/clients` | `client:write` | `{ name, address?, creditTerms?, status?, primaryContactId? }` | `Client` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR` |
| GET | `/api/v1/clients` | `client:read` | none | `Client[]`, branch-scoped, `deletedAt: null`, ordered by `name asc` | `UNAUTHORIZED`, `FORBIDDEN` |
| GET | `/api/v1/clients/:id` | `client:read` | path `{ id }` | `Client & { primaryContact, vessels }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |
| PATCH | `/api/v1/clients/:id` | `client:write` | `{ version, name?, address?, creditTerms?, status?, primaryContactId? }` | `Client` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT` |
| DELETE | `/api/v1/clients/:id` | `client:write` | path `{ id }` | `{ id, deleted: true }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |

`Contact` has no branch field. Non-cross-branch contact direct reads/updates are allowed only when the contact is the `primaryContactId` of an undeleted client in the caller branch. [OD-03, D-019]

### Vessels

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/vessels` | `vessel:read` | query `{ clientId? }` | `Vessel[]`, branch-scoped via owning `Client.branch`, ordered by `name asc` | `UNAUTHORIZED`, `FORBIDDEN` |
| POST | `/api/v1/vessels` | `vessel:write` | `{ clientId, imoNumber, name, type?, flag?, classification? }` | `Vessel` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| GET | `/api/v1/vessels/:id/job-orders` | `vessel:read` | path `{ id }` | `JobOrder[]`, branch-scoped, ordered by `createdAt desc` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |

Duplicate `imoNumber` returns `VALIDATION_ERROR` with `details: { field: 'imoNumber', reason: 'duplicate' }`. [D-024]

### Job Orders

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/job-orders` | `jobOrder:create` | `{ clientId, vesselId, scopeSummary, quotedAmountMinor, quotedCurrency, serviceCategories?, port?, externalQuoteRef?, externalRfqRef?, labourRateAmountMinor?, labourRateCurrency? }` | `JobOrder` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR` |
| GET | `/api/v1/job-orders` | `jobOrder:read` | none | `JobOrder[]`, branch-scoped, ordered by `createdAt desc`; technician-only tokens see rows where `assignedTechnicianIds has userId` OR `executionOwnerId = userId` | `UNAUTHORIZED`, `FORBIDDEN` |
| GET | `/api/v1/job-orders/:id` | `jobOrder:read` | path `{ id }` | `JobOrder & { variations: Variation[] }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |
| GET | `/api/v1/job-orders/:id/financial-summary` | `jobOrder:read` | path `{ id }` | `FinancialSummary` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR` |
| PATCH | `/api/v1/job-orders/:id` | `jobOrder:updateHeader` | `{ version, scopeSummary?, port?, serviceCategories?, plannedStartDate?, externalQuoteRef?, externalRfqRef? }` | `JobOrder` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT` |
| POST | `/api/v1/job-orders/:id/assign` | `jobOrder:assign` | `{ technicianIds, executionOwnerId, version }` | `JobOrder` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT` |
| POST | `/api/v1/job-orders/:id/transition` | `authenticate` + `requireMfaEnrolled`; JOSM gates in service | `{ to, reason?, version }` | `JobOrder` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT`, `STATE_TRANSITION_INVALID` |

Header updates are locked once execution begins. Scope changes after execution begins are represented as `Variation` records. [OD-02, OD-05, CC-02]

`FinancialSummary` source shape:

```ts
export interface FinancialSummary {
  baselineAmountMinor: number;
  baselineCurrency: string;
  actualAmountMinor: number;
  actualCurrency: string;
  revenueAmountMinor: number | null;
  revenueCurrency: string | null;
  varianceAmountMinor: number;
}
```

### Variations

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/job-orders/:id/variations` | `variation:create` | `{ reason, amountMinor, amountCurrency }` | `Variation` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| POST | `/api/v1/variations/:id/approve` | `variation:approve` | `{ version, reason? }` | `Variation` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT`, `STATE_TRANSITION_INVALID` |
| POST | `/api/v1/variations/:id/reject` | `variation:reject` | `{ version, reason? }` | `Variation` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT`, `STATE_TRANSITION_INVALID` |

Every variation is created as `PROPOSED`. Decisions are one-way: only `PROPOSED -> APPROVED` or `PROPOSED -> REJECTED`. Re-deciding returns `STATE_TRANSITION_INVALID`. [D-003, D-021, D-046]

### Sync

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/sync/batch` | `authenticate` + `requireMfaEnrolled` | `{ schemaVersion, ops }`, with max 200 ops | `{ schemaVersion: 1, results: OpResult[] }` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `BATCH_REJECTED_SCHEMA`; per-op `results[].status` uses the OpStatus union |
| GET | `/api/v1/sync/assigned` | `authenticate` + `requireMfaEnrolled` | query `{ since? }` | `{ cursor, jobOrders, children: { worklogs, photos, observations, checklists, materials, esignatures } }` | `UNAUTHORIZED`, `FORBIDDEN` |

`SyncOp` from `apps/api/src/routes/sync.ts`:

```ts
interface SyncOp {
  opId: string;
  entity: WritableEntity;
  action: 'CREATE' | 'UPDATE';
  entityId: string;
  jobOrderId: string;
  payload: Record<string, unknown>;
  baseVersion?: number | null;
}
```

Writable entities from `apps/api/src/domain/sync.ts`:

```ts
export type WritableEntity = 'WorkLog' | 'Photo' | 'Observation' | 'ChecklistInstance' | 'MaterialLine' | 'ESignature';
```

`/sync/assigned` returns only job orders in the caller branch assigned by `assignedTechnicianIds` or `executionOwnerId`, plus changed child rows for those jobs. `changeSeq` is exposed as a string only on this endpoint; normal REST payloads omit it. [D-053, D-054]

### Invoicing

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/invoices` | `invoice:read` | none | `Invoice[]`, branch-scoped, ordered by `createdAt desc` | `UNAUTHORIZED`, `FORBIDDEN` |
| GET | `/api/v1/invoices/:id` | `invoice:read` | path `{ id }` | `Invoice & { lines: InvoiceLine[], payments: Payment[] }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |
| POST | `/api/v1/invoices/:id/issue` | `invoice:issue` | `{ version }` | `Invoice` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT`, `STATE_TRANSITION_INVALID` |
| POST | `/api/v1/invoices/:id/payments` | `invoice:recordPayment` | `{ amountMinor, currency, paidAt?, method?, reference?, version }` | `Invoice & { payments: Payment[] }` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT` |

Invoice issue is the only manual invoice lifecycle transition in live API source. It changes `DRAFT -> SENT`, computes `issuedAt` and `dueAt`, appends audit, then enqueues PDF and email delivery outside the transaction. Payment recording inserts an immutable `Payment` row and recomputes status as `SENT`, `PARTIAL`, or `PAID` from the payment sum. [D-034, D-035, D-037, D-045]

### Documents And Certificates

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/uploads/presign` | `authenticate` + `requireMfaEnrolled` | `{ entity, jobOrderId, contentType, byteSize? }`, where `entity` is `Photo` or `ESignature` | `{ uploadUrl, s3Key, method: 'PUT', headers }` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| POST | `/api/v1/documents/presign` | `document:write` | `{ ownerType, ownerId, filename, mimeType, byteSize? }`, where `ownerType` is `CLIENT`, `VESSEL`, or `JOB` | `{ uploadUrl, s3Key, method: 'PUT', headers }` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| POST | `/api/v1/documents` | `document:write` | `{ ownerType, ownerId, filename, mimeType, s3Key }` | `Document` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| GET | `/api/v1/documents` | `document:read` | query `{ ownerType, ownerId }` | `Document[]`, ordered by `createdAt desc` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| DELETE | `/api/v1/documents/:id` | `document:write` | path `{ id }` | `{ id, deleted: true }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |
| POST | `/api/v1/documents/:id/replace` | `document:write` | `{ filename, mimeType, s3Key }` | replacement `Document` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| POST | `/api/v1/certificates` | `certificate:write` | `{ ownerType, ownerId, certType, identifier?, issuedAt?, expiresAt, s3Key? }`, where `ownerType` is `TECHNICIAN`, `VESSEL`, or `COMPANY` | `Certificate` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| GET | `/api/v1/certificates` | `certificate:read` | query `{ ownerType, ownerId }` | `Certificate[]`, `deletedAt: null`, ordered by `expiresAt asc` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| DELETE | `/api/v1/certificates/:id` | `certificate:write` | path `{ id }` | `{ id, deleted: true }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |

Document owner branch is resolved from `CLIENT`, `VESSEL`, or `JOB`. Certificate owner branch is resolved from `TECHNICIAN` via `User.branch`, `VESSEL` via owning client, and `COMPANY` is unscoped. [D-041, D-042, D-043]

### Review Queue

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/review-queue` | `review:read` | query `{ state? }`, default `PENDING_SUPERVISOR_REVIEW` | `{ worklog, photo, observation, checklist, material, esignature }`, each value an array, max 200 per entity | `UNAUTHORIZED`, `FORBIDDEN` |
| POST | `/api/v1/review/:entity/:id/accept` | `review:resolve` | path `entity` in `worklog|photo|observation|checklist|material|esignature`; body `{ reason? }` | `{ id, entity, reviewState: 'ACCEPTED' }` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| POST | `/api/v1/review/:entity/:id/reject` | `review:resolve` | path `entity` in `worklog|photo|observation|checklist|material|esignature`; body `{ reason? }` | `{ id, entity, reviewState: 'REJECTED' }` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |

Offline ops from an unassigned technician are applied and marked `PENDING_SUPERVISOR_REVIEW`; the review routes accept or reject those rows. [D-002, SYNC-13, CC-MOB-2]

### Checklists

| Method | Path | Auth/RBAC | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/checklist-templates` | `material:write` | `{ name, serviceCategory?, jobType?, items }`, where `items` is `ChecklistItemDef[]` | `ChecklistTemplate` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR` |
| GET | `/api/v1/checklist-templates` | `authenticate` + `requireMfaEnrolled` | none | active `ChecklistTemplate[]`, ordered by `name asc` | `UNAUTHORIZED`, `FORBIDDEN` |
| POST | `/api/v1/job-orders/:id/checklists` | `authenticate` + `requireMfaEnrolled` | `{ templateId }` | `ChecklistInstance` with HTTP 201 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND` |
| POST | `/api/v1/checklists/:id/submit` | `authenticate` + `requireMfaEnrolled` | `{ results, version }`, where `results` is `ChecklistItemResult[]` | `ChecklistInstance` | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT` |

Checklist templates and results are stored in Json columns and validated at the API/service boundary. [D-010, CC-4]

## 5. RBAC Matrix

Roles that may reach across branches:

```ts
export const CROSS_BRANCH_ROLES: ReadonlySet<Role> = new Set<Role>(['SYSTEM_ADMIN', 'DIRECTOR']); // [CONTRACT]
```

Roles that must complete TOTP at login:

```ts
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['SYSTEM_ADMIN', 'FINANCE']);
```

Verbatim `MATRIX` block from `apps/api/src/domain/rbac.ts`:

```ts
const MATRIX: Record<Role, ReadonlySet<Action>> = {
  // [INFERRED] admin superset (routine ownership); PM confirm scope of SYSTEM_ADMIN.
  SYSTEM_ADMIN: new Set<Action>([
    'client:read', 'client:write', 'contact:read', 'contact:write', 'vessel:read', 'vessel:write',
    'jobOrder:read', 'jobOrder:create', 'jobOrder:updateHeader', 'jobOrder:assign',
    'variation:create',
    'review:read', 'review:resolve', 'invoice:read', 'invoice:create', 'invoice:issue', 'invoice:recordPayment',
    'document:read', 'document:write', 'certificate:read', 'certificate:write',
    'material:write', 'audit:read', 'user:admin',
  ]),
  // Director: approves/rejects EVERY variation (D-003) [CONTRACT]; consolidated cross-branch
  // READ (RBAC-CROSS-1) [CONTRACT]. Not wired for routine CRUD [INFERRED].
  DIRECTOR: new Set<Action>([
    'client:read', 'contact:read', 'vessel:read', 'jobOrder:read',
    'variation:approve', 'variation:reject', 'review:read', 'invoice:read', 'invoice:recordPayment', 'audit:read',
    'document:read', 'document:write', 'certificate:read', 'certificate:write',
  ]),
  // Finance: invoicing only; MUST NOT edit job scope (RBAC-FIN-1) [CONTRACT] -> no jobOrder
  // header/assign, no variation:create/approve.
  FINANCE: new Set<Action>([
    'client:read', 'vessel:read', 'jobOrder:read',
    'invoice:read', 'invoice:create', 'invoice:issue', 'invoice:recordPayment', 'audit:read',
    'document:read', 'certificate:read',
  ]),
  // Ops supervisor: office CRUD + JO lifecycle + variation PROPOSE + review queue [INFERRED,
  // consistent with JOSM gating in contract]. NOT variation:approve (Director only) [CONTRACT].
  OPS_SUPERVISOR: new Set<Action>([
    'client:read', 'client:write', 'contact:read', 'contact:write', 'vessel:read', 'vessel:write',
    'jobOrder:read', 'jobOrder:create', 'jobOrder:updateHeader', 'jobOrder:assign',
    'variation:create', 'review:read', 'review:resolve', 'material:write', 'invoice:read',
    'document:read', 'document:write', 'certificate:read', 'certificate:write',
  ]),
  // Technician: reads ONLY their assigned jobs (row-level IDOR check is separate, RBAC-IDOR-1);
  // adds field materials (OD-01). Execution-state transitions are execution-owner-gated in JOSM,
  // not role-gated here. [INFERRED where not covered by contract]
  TECHNICIAN: new Set<Action>(['jobOrder:read', 'material:write']),
};
```

The role/action table below is the same matrix formatted for scanning. `yes` means `MATRIX[role].has(action)`.

| Action | SYSTEM_ADMIN | DIRECTOR | FINANCE | OPS_SUPERVISOR | TECHNICIAN |
| --- | --- | --- | --- | --- | --- |
| `client:read` | yes | yes | yes | yes |  |
| `client:write` | yes |  |  | yes |  |
| `contact:read` | yes | yes |  | yes |  |
| `contact:write` | yes |  |  | yes |  |
| `vessel:read` | yes | yes | yes | yes |  |
| `vessel:write` | yes |  |  | yes |  |
| `jobOrder:read` | yes | yes | yes | yes | yes |
| `jobOrder:create` | yes |  |  | yes |  |
| `jobOrder:updateHeader` | yes |  |  | yes |  |
| `jobOrder:assign` | yes |  |  | yes |  |
| `variation:create` | yes |  |  | yes |  |
| `variation:approve` |  | yes |  |  |  |
| `variation:reject` |  | yes |  |  |  |
| `review:read` | yes | yes |  | yes |  |
| `review:resolve` | yes |  |  | yes |  |
| `invoice:read` | yes | yes | yes | yes |  |
| `invoice:create` | yes |  | yes |  |  |
| `invoice:issue` | yes |  | yes |  |  |
| `invoice:recordPayment` | yes | yes | yes |  |  |
| `document:read` | yes | yes | yes | yes |  |
| `document:write` | yes | yes |  | yes |  |
| `certificate:read` | yes | yes | yes | yes |  |
| `certificate:write` | yes | yes |  | yes |  |
| `material:write` | yes |  |  | yes | yes |
| `audit:read` | yes | yes | yes |  |  |
| `user:admin` | yes |  |  |  |  |

## 6. Sync Protocol

### Schema And Batch

`SYNC_SCHEMA_VERSION` is `1`. `/api/v1/sync/batch` rejects any request where `schemaVersion !== 1` with batch-level `BATCH_REJECTED_SCHEMA`. `ops` must be an array and must contain no more than 200 ops. Each op is applied in its own transaction, so one op failure does not roll back unrelated ops in the same batch. [D-020]

Batch request:

```ts
{
  schemaVersion: number;
  ops: SyncOp[];
}
```

Batch response:

```ts
{
  schemaVersion: 1;
  results: OpResult[];
}
```

### OpStatus Verbatim Source

```ts
export type OpApplyStatus = 'APPLIED' | 'APPLIED_FLAGGED';
```

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID'
  | 'BATCH_REJECTED_SCHEMA';
```

```ts
interface OpResult {
  opId: string;
  status: OpApplyStatus | 'IDEMPOTENT_REPLAY' | ErrorCode;
  resultRef?: string;
  serverVersion?: number;
  reviewState?: string;
  error?: { code: string; message: string };
}
```

Disposition implemented server-side:

| Status | Source meaning |
| --- | --- |
| `APPLIED` | op applied and recorded in `ProcessedOp` |
| `APPLIED_FLAGGED` | op applied but `reviewState` set, usually unassigned while offline |
| `IDEMPOTENT_REPLAY` | prior `opId` found; original result reference returned |
| `VALIDATION_ERROR` | invalid op/entity/job/payload/template/results, or caught AppError |
| `UNAUTHORIZED` | normally batch-level auth failure, also part of the `ErrorCode` union |
| `FORBIDDEN` | caught AppError from business logic, also part of the `ErrorCode` union |
| `NOT_FOUND` | caught AppError from business logic, also part of the `ErrorCode` union |
| `VERSION_CONFLICT` | `baseVersion` differs from existing row version |
| `BRANCH_SCOPE_DENIED` | sync op targets a JO outside caller branch |
| `STATE_TRANSITION_INVALID` | caught AppError from business logic, also part of the `ErrorCode` union |
| `BATCH_REJECTED_SCHEMA` | normally batch-level schema/max-size failure, also part of the `ErrorCode` union |

### Assigned Delta Cursor

`GET /api/v1/sync/assigned` reads `since` via `parseChangeSeqCursor`. Server-side source treats missing, empty, malformed, or negative cursors as `0n`, then compares against `changeSeq` bigint columns. The API response serializes `cursor` and all returned row `changeSeq` values as decimal strings. [D-053]

Client-facing rule from D-053: clients must treat `since`/`cursor` as opaque strings and only store/echo them. The server is the only component that parses/interprets them.

Response shape:

```ts
{
  cursor: string;
  jobOrders: Array<JobOrder & { changeSeq: string }>;
  children: {
    worklogs: Array<WorkLog & { changeSeq: string }>;
    photos: Array<Photo & { changeSeq: string }>;
    observations: Array<Observation & { changeSeq: string }>;
    checklists: Array<ChecklistInstance & { changeSeq: string }>;
    materials: Array<MaterialLine & { changeSeq: string }>;
    esignatures: Array<ESignature & { changeSeq: string }>;
  };
}
```

Normal REST endpoints do not expose `changeSeq`; `apps/api/src/app.ts` strips it during serialization except for `/api/v1/sync/assigned`.

## 7. Changelog

- v1.1 (reconstructed 2026-08-30) — first git-tracked version, derived from live source.

## OPEN DISCREPANCIES

### 1. No named `OpStatus` type exists in live source

`RESOLVED_DECISIONS.md` says:

> `CC-5 | Sync per-op result enum — CORRECTED to 11 statuses (was mistakenly documented as 8): APPLIED, APPLIED_FLAGGED, IDEMPOTENT_REPLAY, VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VERSION_CONFLICT, BRANCH_SCOPE_DENIED, STATE_TRANSITION_INVALID, BATCH_REJECTED_SCHEMA. ProcessedOp keyed on opId.`

Live source shows no named `type OpStatus`. It shows:

```ts
export type OpApplyStatus = 'APPLIED' | 'APPLIED_FLAGGED';
```

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID'
  | 'BATCH_REJECTED_SCHEMA';
```

```ts
status: OpApplyStatus | 'IDEMPOTENT_REPLAY' | ErrorCode;
```

This document records the effective union as the contract, but TL should decide whether a named exported `OpStatus` type should be added.

### 2. Historical references to `INTERFACE_CONTRACT v1.1` existed before this tracked file

`RESOLVED_DECISIONS.md` says:

> `Contract changes (CC-###) — ratified into INTERFACE_CONTRACT v1.1`

Live git source before this commit had no `INTERFACE_CONTRACT.md` file at root or elsewhere. Multiple source comments also refer to `INTERFACE_CONTRACT v1.1`, for example `apps/api/src/lib/errors.ts`:

```ts
// Standard error codes — INTERFACE_CONTRACT v1.1 §1. One AppError type; the Fastify error
// handler maps `.code` -> HTTP status. Codes are the contract's, not ad-hoc strings.
```

This commit creates the first tracked version from live source.

### 3. D-024 structured validation details are not applied consistently

`RESOLVED_DECISIONS.md` says:

> `D-024 | Structured validation-error details | Every field-specific VALIDATION_ERROR MUST include details: { field: string; reason: string } in the error body ... Applies going forward to all new field-specific validation errors, not just this one.`

Live source supports `details` in the error envelope:

```ts
return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
```

Live source includes details for duplicate IMO:

```ts
if (existing) throw new AppError('VALIDATION_ERROR', 'imoNumber already registered', { field: 'imoNumber', reason: 'duplicate' });
```

But many field-specific validation errors omit details, for example:

```ts
if (!b.name) throw new AppError('VALIDATION_ERROR', 'name required');
if (typeof b.version !== 'number') throw new AppError('VALIDATION_ERROR', 'version required');
if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_ERROR', `${name} required`);
```

The contract documents the live envelope shape, but TL should decide whether to retrofit details across existing route validators.

### 4. D-034 credit-terms parsing prose differs from live source

`RESOLVED_DECISIONS.md` says:

> `N parsed from Client.creditTerms via pattern /^NET(\d+)$/i (matches "NET30"/"net45" etc.); if null/empty/non-matching, silently default to 30 days`

Live source in `apps/api/src/domain/invoiceLifecycle.ts` says:

```ts
const match = creditTerms.match(/(\d+)/);
```

The implementation accepts any first digit sequence in the free-text value, not only `NET###`. This document records the live source behavior.

### 5. D-044 says `DIRECTOR` must be in office transition roles, but live JOSM excludes it

`RESOLVED_DECISIONS.md` says:

> `D-044 | officeRoles must include DIRECTOR ... Ruling: add DIRECTOR to officeRoles for ALL 6 uniformly`

Live source in `apps/api/src/domain/josm.ts` says:

```ts
const OFFICE: Role[] = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN'];
const CANCEL_ROLES: Role[] = ['OPS_SUPERVISOR', 'SYSTEM_ADMIN', 'DIRECTOR']; // [INFERRED] who may cancel
```

So `DIRECTOR` is included for cancellation but not for office-gated transitions using `OFFICE`: `DRAFT -> SCHEDULED`, `PENDING_REVIEW -> COMPLETED`, `PENDING_REVIEW -> IN_PROGRESS`, `SCHEDULED -> ON_HOLD`, `IN_PROGRESS -> ON_HOLD`, and `ON_HOLD` resume.

The contract documents live behavior. TL should decide whether source needs to be aligned to D-044.

### 6. D-035 says `Payment` DB-level immutability is extended, but migration source shows it is still pending

`RESOLVED_DECISIONS.md` says:

> `D-035 | New immutable Payment model ... extends D-014's DB-level immutability (marinex_app REVOKE) to include Payment.`

Live migration source for the payment model says:

```sql
-- NEEDS OPS: extend provision-app-role.sql's REVOKE UPDATE, DELETE to include "Payment" (D-014/D-035).
```

The audit immutability migration only revokes:

```sql
REVOKE UPDATE, DELETE ON "AuditEntry"       FROM marinex_app;
REVOKE UPDATE, DELETE ON "JobStatusHistory" FROM marinex_app;
```

The contract records `Payment` as insert-only by route surface (no update/delete endpoints), but DB-level immutability for `Payment` is not proven by the migration source shown here.

### 7. D-050 references `FeatureFlag` and `ErrorLog` models/routes, but live API source has none

`RESOLVED_DECISIONS.md` says:

> `Feature flags — a FeatureFlag model (key, enabled, description, category, updatedBy, updatedAt) ...`

and:

> `Admin error/activity log console — a new ErrorLog model, DISTINCT from AuditEntry ...`

Live `prisma/schema.prisma` does not define `FeatureFlag` or `ErrorLog`, and `apps/api/src/routes/*.ts` does not expose feature-flag or admin error-log endpoints. This appears to be future P3-12 scope rather than current live API, so it is not included in the endpoint contract.

### 8. D-046 says `SYSTEM_ADMIN` can approve/reject variations, but live RBAC excludes it

`RESOLVED_DECISIONS.md` says:

> `variationApproveRoles/variationRejectRoles = ['DIRECTOR','SYSTEM_ADMIN'] — confirmed correct`

Live `apps/api/src/domain/rbac.ts` includes only `DIRECTOR` for `variation:approve` and `variation:reject`; `SYSTEM_ADMIN` has `variation:create` but not approve/reject:

```ts
SYSTEM_ADMIN: new Set<Action>([
  'client:read', 'client:write', 'contact:read', 'contact:write', 'vessel:read', 'vessel:write',
  'jobOrder:read', 'jobOrder:create', 'jobOrder:updateHeader', 'jobOrder:assign',
  'variation:create',
  'review:read', 'review:resolve', 'invoice:read', 'invoice:create', 'invoice:issue', 'invoice:recordPayment',
  'document:read', 'document:write', 'certificate:read', 'certificate:write',
  'material:write', 'audit:read', 'user:admin',
]),
DIRECTOR: new Set<Action>([
  'client:read', 'contact:read', 'vessel:read', 'jobOrder:read',
  'variation:approve', 'variation:reject', 'review:read', 'invoice:read', 'invoice:recordPayment', 'audit:read',
  'document:read', 'document:write', 'certificate:read', 'certificate:write',
]),
```

The live API routes require `variation:approve`/`variation:reject`, so this matrix means `SYSTEM_ADMIN` cannot approve or reject variations today.

### 9. D-020 describes below-minimum schema rejection, but live `/sync/batch` rejects any mismatch

`RESOLVED_DECISIONS.md` says:

> `SYNC-07: a schemaVersion below the server minimum rejects the WHOLE batch (BATCH_REJECTED_SCHEMA)`

Live `apps/api/src/routes/sync.ts` says:

```ts
export const SYNC_SCHEMA_VERSION = 1;
```

and:

```ts
if (schemaVersion !== SYNC_SCHEMA_VERSION) {
  // Whole batch rejected, queue preserved client-side, never partially applied (ADR-3).
  throw new AppError('BATCH_REJECTED_SCHEMA', `expected schemaVersion ${SYNC_SCHEMA_VERSION}`);
}
```

So live behavior rejects newer client schema versions as well as older versions.

### 10. `Document.ownerType` schema comment lags live route behavior

Live `prisma/schema.prisma` says:

```prisma
model Document {
  id String @id @default(uuid())
  ownerType String                     // JOB | VESSEL
  ownerId String
```

Live `apps/api/src/routes/documents.ts` allows `CLIENT`, `VESSEL`, and `JOB`:

```ts
const DOCUMENT_OWNER_TYPES = ['CLIENT', 'VESSEL', 'JOB'] as const;
```

The endpoint contract records the route behavior (`CLIENT | VESSEL | JOB`). TL should decide whether the schema comment should be corrected.
