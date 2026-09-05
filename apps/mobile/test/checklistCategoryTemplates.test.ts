import { describe, expect, it } from 'vitest';
import {
  JOB_ORDER_CATEGORY_OPTIONS,
  checklistItemsForCategory,
  isJobOrderCategory,
} from '../src/lib/checklistCategoryTemplates';

describe('checklist category templates', () => {
  it('provides distinct demo checklist items for each D-073 job category', () => {
    const categories = JOB_ORDER_CATEGORY_OPTIONS.map((category) => category.value);

    expect(categories).toEqual(['inspection', 'electrical', 'mechanical', 'hull', 'safety', 'other']);

    const itemSets = categories.map((category) => checklistItemsForCategory(category));
    for (const items of itemSets) {
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(5);
    }

    const firstItemIds = itemSets.map((items) => items[0]?.id);
    expect(new Set(firstItemIds).size).toBe(categories.length);
  });

  it('validates category values', () => {
    expect(isJobOrderCategory('inspection')).toBe(true);
    expect(isJobOrderCategory('not-a-category')).toBe(false);
  });
});
