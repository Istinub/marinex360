import type { Money } from './api/types';

export function formatMoney({ amountMinor, currency }: Money): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

export const moneyTextClass = 'mx-money';
