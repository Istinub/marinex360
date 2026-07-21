// Checklist item/response shapes — ratified by TL (S0-8, G-4). The Prisma columns
// (ChecklistTemplate.items, ChecklistInstance.results) stay Json; THIS module is the
// enforcement boundary at the service/API layer, not a schema change.
import { AppError } from '../lib/errors.js';

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

const TYPES: ReadonlySet<ChecklistItemType> = new Set(['bool', 'text', 'number', 'select', 'photo']);

function fail(msg: string): never {
  throw new AppError('VALIDATION_ERROR', `checklist: ${msg}`);
}

/** Validate a ChecklistTemplate.items definition array (admin-authored, so failures are loud). */
export function validateItemDefs(items: unknown): ChecklistItemDef[] {
  if (!Array.isArray(items) || items.length === 0) fail('items must be a non-empty array');
  const ids = new Set<string>();
  for (const raw of items) {
    const it = raw as Partial<ChecklistItemDef>;
    if (!it || typeof it !== 'object') fail('each item must be an object');
    if (!it.id || typeof it.id !== 'string') fail('item.id is required');
    if (ids.has(it.id)) fail(`duplicate item id "${it.id}"`);
    ids.add(it.id);
    if (!it.label || typeof it.label !== 'string') fail(`item "${it.id}": label is required`);
    if (!it.type || !TYPES.has(it.type as ChecklistItemType)) fail(`item "${it.id}": invalid type "${it.type}"`);
    if (typeof it.required !== 'boolean') fail(`item "${it.id}": required must be boolean`);
    if (it.type === 'select') {
      if (!Array.isArray(it.options) || it.options.length === 0) fail(`item "${it.id}": select requires non-empty options[]`);
      if (it.options.some((o) => typeof o !== 'string')) fail(`item "${it.id}": options must be strings`);
    }
    if (it.type !== 'select' && it.options !== undefined) fail(`item "${it.id}": options only valid for type "select"`);
    if (it.unit !== undefined && it.type !== 'number') fail(`item "${it.id}": unit only valid for type "number"`);
  }
  return items as ChecklistItemDef[];
}

/**
 * Validate ChecklistInstance.results against its template's item defs.
 *  - every required, non-N/A item must have a non-null value of the right JS type
 *  - 'select' values must be one of the def's options
 *  - 'photo' items must carry photoOpId (links to the Photo row via opId, OD-04/SYNC-13 path)
 *  - unknown itemIds (not in the template) are rejected — no silent drift from the template
 */
export function validateResults(defs: ChecklistItemDef[], results: unknown): ChecklistItemResult[] {
  if (!Array.isArray(results)) fail('results must be an array');
  const byId = new Map(defs.map((d) => [d.id, d]));
  const seen = new Set<string>();

  for (const raw of results) {
    const r = raw as Partial<ChecklistItemResult>;
    if (!r || typeof r !== 'object' || !r.itemId) fail('each result requires itemId');
    if (seen.has(r.itemId)) fail(`duplicate result for item "${r.itemId}"`);
    seen.add(r.itemId);
    const def = byId.get(r.itemId);
    if (!def) fail(`result references unknown item "${r.itemId}"`);

    if (r.na === true) continue; // N/A override short-circuits all checks

    if (def.type === 'photo') {
      // Photo items carry their payload in photoOpId; `value` is legitimately always null.
      if (def.required && !r.photoOpId) fail(`item "${def.id}": photo item requires photoOpId`);
      if (r.photoOpId !== undefined && typeof r.photoOpId !== 'string') fail(`item "${def.id}": photoOpId must be a string`);
      continue;
    }

    if (def.required && (r.value === null || r.value === undefined)) {
      fail(`item "${def.id}" ("${def.label}") is required`);
    }
    if (r.value !== null && r.value !== undefined) {
      switch (def.type) {
        case 'bool':
          if (typeof r.value !== 'boolean') fail(`item "${def.id}": expected boolean`);
          break;
        case 'text':
          if (typeof r.value !== 'string') fail(`item "${def.id}": expected string`);
          break;
        case 'number':
          if (typeof r.value !== 'number' || !Number.isFinite(r.value)) fail(`item "${def.id}": expected finite number`);
          break;
        case 'select':
          if (typeof r.value !== 'string' || !def.options?.includes(r.value)) {
            fail(`item "${def.id}": value must be one of [${def.options?.join(', ')}]`);
          }
          break;
      }
    }
  }

  const missingRequired = defs.filter((d) => d.required && !seen.has(d.id));
  if (missingRequired.length) {
    fail(`missing required item(s): ${missingRequired.map((d) => d.id).join(', ')}`);
  }
  return results as ChecklistItemResult[];
}
