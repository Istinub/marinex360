// Invoice generation config — placeholder values pending OD-07 (FX)/OD-09 (per-branch tax).
// D-031: SG-only/SGD for Phase 3 MVP, no conversion logic. True multi-currency (OD-07) is a
// LATER P3 increment — manual FX rate table, Finance-maintained, snapshotted onto the Invoice
// at DRAFT-creation, locked at issuedAt (same pattern as D-011) — NOT built yet, correctly out
// of scope for this drop.
// D-032: SG GST only (schema fields are GST-named, not generic tax) — MY/ID/BD (SST/PPN/VAT)
// have no schema fields yet; real gap, out of MVP scope.
// TODO-GST-RATE (D-033): interim placeholder rate, PM-approved as a stand-in ONLY — NOT
// verified against current IRAS regulations. Single configurable value, never hardcoded inline
// at any calculation site (see domain/invoice.ts, which reads only this export). Replace with
// the real verified rate once PM/Finance confirms it — should be a one-line config change here,
// not a code change anywhere else.
export const GST_RATE_PERCENT = Number(process.env.GST_RATE_PERCENT ?? '9'); // TODO-GST-RATE placeholder

// D-031: SG→SGD only for Phase 3 MVP. Any other branch is NOT YET SUPPORTED for auto-invoicing —
// explicit rejection rather than a silent wrong-currency guess.
export const BRANCH_CURRENCY: Readonly<Record<string, string>> = { SG: 'SGD' };
