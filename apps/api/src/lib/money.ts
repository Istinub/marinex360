// Money — integer minor units + ISO-4217 currency. NEVER float (CONV-MONEY-1/2).
import { AppError } from './errors.js';

export interface Money {
  amountMinor: number; // integer minor units (e.g. cents)
  currency: string;    // ISO-4217, e.g. "SGD"
}

const ISO4217 = /^[A-Z]{3}$/;

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new AppError('VALIDATION_ERROR', `amountMinor must be an integer, got ${amountMinor}`);
  }
  if (!ISO4217.test(currency)) {
    throw new AppError('VALIDATION_ERROR', `currency must be ISO-4217, got "${currency}"`);
  }
  return { amountMinor, currency };
}

// Sum in integer minor units. Mixed-currency is REJECTED, not coerced (CONV-MONEY-2).
export function sumMoney(items: Money[]): Money {
  if (items.length === 0) throw new AppError('VALIDATION_ERROR', 'cannot sum an empty money list');
  const currency = items[0].currency;
  let total = 0;
  for (const m of items) {
    if (m.currency !== currency) {
      throw new AppError('VALIDATION_ERROR', `mixed-currency sum rejected: ${currency} vs ${m.currency}`);
    }
    if (!Number.isInteger(m.amountMinor)) {
      throw new AppError('VALIDATION_ERROR', 'non-integer minor unit in sum');
    }
    total += m.amountMinor;
  }
  return { amountMinor: total, currency };
}

// D-004: per-job labourRate defaults to SGD 90.00/hr (9000 minor) at the service layer.
export const DEFAULT_LABOUR_RATE: Money = { amountMinor: 9000, currency: 'SGD' };
