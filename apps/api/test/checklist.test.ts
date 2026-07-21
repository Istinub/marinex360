import { describe, it, expect } from 'vitest';
import { validateItemDefs, validateResults, type ChecklistItemDef } from '../src/domain/checklist.js';

const defs: ChecklistItemDef[] = [
  { id: 'i1', label: 'Guard rails secured', type: 'bool', required: true },
  { id: 'i2', label: 'Notes', type: 'text', required: false },
  { id: 'i3', label: 'Insulation resistance', type: 'number', required: true, unit: 'MΩ' },
  { id: 'i4', label: 'Weather', type: 'select', required: true, options: ['Clear', 'Rain', 'Rough seas'] },
  { id: 'i5', label: 'Nameplate photo', type: 'photo', required: true },
];

describe('validateItemDefs (template authoring)', () => {
  it('accepts a well-formed template', () => {
    expect(validateItemDefs(defs)).toEqual(defs);
  });
  it('rejects empty/non-array', () => {
    expect(() => validateItemDefs([])).toThrowError(/non-empty array/);
    expect(() => validateItemDefs('nope')).toThrow();
  });
  it('rejects duplicate ids', () => {
    expect(() => validateItemDefs([defs[0], defs[0]])).toThrowError(/duplicate item id/);
  });
  it('rejects invalid type', () => {
    expect(() => validateItemDefs([{ id: 'x', label: 'x', type: 'date', required: true }])).toThrowError(/invalid type/);
  });
  it('select requires non-empty options', () => {
    expect(() => validateItemDefs([{ id: 'x', label: 'x', type: 'select', required: true }])).toThrowError(/non-empty options/);
  });
  it('options only valid on select', () => {
    expect(() => validateItemDefs([{ id: 'x', label: 'x', type: 'text', required: true, options: ['a'] }])).toThrowError(/options only valid/);
  });
  it('unit only valid on number', () => {
    expect(() => validateItemDefs([{ id: 'x', label: 'x', type: 'text', required: true, unit: 'kg' }])).toThrowError(/unit only valid/);
  });
});

describe('validateResults (field submission)', () => {
  const full = [
    { itemId: 'i1', value: true },
    { itemId: 'i2', value: 'all clear' },
    { itemId: 'i3', value: 42.5 },
    { itemId: 'i4', value: 'Clear' },
    { itemId: 'i5', value: null, photoOpId: 'op-abc-123' },
  ];

  it('accepts a fully completed, well-typed submission', () => {
    expect(validateResults(defs, full)).toEqual(full);
  });

  it('rejects missing required item', () => {
    const missing = full.filter((r) => r.itemId !== 'i1');
    expect(() => validateResults(defs, missing)).toThrowError(/missing required/);
  });

  it('N/A override bypasses the required check', () => {
    const withNA = full.map((r) => (r.itemId === 'i1' ? { itemId: 'i1', value: null, na: true } : r));
    expect(validateResults(defs, withNA)).toBeTruthy();
  });

  it('rejects wrong JS type for bool/number', () => {
    expect(() => validateResults(defs, full.map((r) => (r.itemId === 'i1' ? { itemId: 'i1', value: 'yes' } : r))))
      .toThrowError(/expected boolean/);
    expect(() => validateResults(defs, full.map((r) => (r.itemId === 'i3' ? { itemId: 'i3', value: 'a lot' } : r))))
      .toThrowError(/expected finite number/);
  });

  it('rejects select value outside options', () => {
    expect(() => validateResults(defs, full.map((r) => (r.itemId === 'i4' ? { itemId: 'i4', value: 'Snowing' } : r))))
      .toThrowError(/must be one of/);
  });

  it('photo item requires photoOpId', () => {
    expect(() => validateResults(defs, full.map((r) => (r.itemId === 'i5' ? { itemId: 'i5', value: null } : r))))
      .toThrowError(/requires photoOpId/);
  });

  it('rejects unknown itemId (drift from template)', () => {
    expect(() => validateResults(defs, [...full, { itemId: 'i99', value: 'x' }])).toThrowError(/unknown item/);
  });

  it('rejects duplicate result for same item', () => {
    expect(() => validateResults(defs, [...full, { itemId: 'i1', value: false }])).toThrowError(/duplicate result/);
  });
});
