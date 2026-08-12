// Invoice generation config — placeholder values pending OD-07 (FX)/OD-09 (per-branch tax).
// GST rate is a CONFIG VALUE (env-overridable), never a hardcoded literal at the calculation
// site; currency is SG-only/SGD for MVP, no conversion logic.
export const GST_RATE_PERCENT = Number(process.env.GST_RATE_PERCENT ?? '9'); // D-033 placeholder

// D-031: SG→SGD only for MVP. Any other branch is NOT YET SUPPORTED for auto-invoicing —
// explicit rejection rather than a silent wrong-currency guess.
export const BRANCH_CURRENCY: Readonly<Record<string, string>> = { SG: 'SGD' };
