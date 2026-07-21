import { describe, it, expect } from 'vitest';
import { money, sumMoney, DEFAULT_LABOUR_RATE } from '../src/lib/money.js';

describe('money (CONV-MONEY)', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(90.5, 'SGD')).toThrowError(/integer/);
  });
  it('rejects non ISO-4217 currency', () => {
    expect(() => money(9000, 'sing')).toThrowError(/ISO-4217/);
  });
  it('sums same-currency in integer minor units', () => {
    expect(sumMoney([money(9000, 'SGD'), money(1050, 'SGD')])).toEqual({ amountMinor: 10050, currency: 'SGD' });
  });
  it('rejects mixed-currency sums (CONV-MONEY-2)', () => {
    expect(() => sumMoney([money(9000, 'SGD'), money(100, 'MYR')])).toThrowError(/mixed-currency/);
  });
  it('default labour rate is SGD 90.00/hr (D-004)', () => {
    expect(DEFAULT_LABOUR_RATE).toEqual({ amountMinor: 9000, currency: 'SGD' });
  });
});
