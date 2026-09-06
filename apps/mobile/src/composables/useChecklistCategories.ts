import { authenticatedFetch } from './useAuth.ts';
import { apiBase, type ChecklistItemDef, type MobileSqlAdapter } from './useOfflineExecution.ts';

export interface ChecklistTemplateItem {
  id: string;
  categoryId: string;
  label: string;
  sortOrder: number;
}

export interface ChecklistCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: ChecklistTemplateItem[];
}

interface TemplateCacheRow {
  id: string;
  name: string | null;
  service_category: string | null;
  items_json: string;
  version: number;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

function templateId(categoryId: string): string {
  return `fixed-${categoryId}`;
}

function parseItems(value: string): ChecklistTemplateItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      const row = item as Partial<ChecklistTemplateItem>;
      if (typeof row.id !== 'string' || typeof row.label !== 'string') return [];
      return [{
        id: row.id,
        categoryId: typeof row.categoryId === 'string' ? row.categoryId : '',
        label: row.label,
        sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : (index + 1) * 10,
      }];
    });
  } catch {
    return [];
  }
}

async function cacheCategories(categories: ChecklistCategory[]): Promise<void> {
  const adapter = db();
  if (!adapter) return;

  for (const category of categories) {
    await adapter.execute(
      `INSERT INTO checklist_template_cache
        (id, name, service_category, job_type, items_json, version)
       VALUES (?, ?, ?, NULL, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         service_category=excluded.service_category,
         items_json=excluded.items_json,
         version=excluded.version`,
      [
        templateId(category.id),
        `${category.name} checklist`,
        category.id,
        JSON.stringify(category.items.map((item) => ({
          id: item.id,
          categoryId: category.id,
          label: item.label,
          sortOrder: item.sortOrder,
        }))),
      ],
    );
  }
}

export async function loadCachedChecklistCategories(): Promise<ChecklistCategory[]> {
  const adapter = db();
  if (!adapter) return [];

  const rows = await adapter.select<TemplateCacheRow>(
    `SELECT id, name, service_category, items_json, version
     FROM checklist_template_cache
     WHERE service_category IS NOT NULL
     ORDER BY service_category ASC`,
  );

  return rows.map((row, index) => {
    const categoryId = row.service_category ?? row.id.replace(/^fixed-/, '');
    return {
      id: categoryId,
      name: row.name?.replace(/\s+checklist$/i, '') || categoryId,
      sortOrder: (index + 1) * 10,
      items: parseItems(row.items_json).map((item) => ({ ...item, categoryId })),
    };
  });
}

export async function loadLiveChecklistCategories(): Promise<ChecklistCategory[]> {
  const response = await authenticatedFetch(`${apiBase()}/checklist-categories`, {
    headers: { Accept: 'application/json' },
  });
  const body = await response.json() as ChecklistCategory[];
  if (!response.ok) throw new Error('Unable to load checklist categories.');
  await cacheCategories(body);
  return body;
}

export async function loadChecklistCategories(): Promise<ChecklistCategory[]> {
  try {
    if (typeof navigator === 'undefined' || navigator.onLine) return await loadLiveChecklistCategories();
  } catch {
    // Fall back to the local cache below when offline or when refresh fails.
  }
  return loadCachedChecklistCategories();
}
