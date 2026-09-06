import type { MobileSqlAdapter } from './useOfflineExecution.ts';

export interface TodayActivity {
  checklistItemsTicked: number;
  observationsAdded: number;
  jobsOpened: number;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

interface ChecklistRow {
  results_json: string;
}

interface CountRow {
  n: number | string;
}

interface ChecklistResult {
  itemId?: unknown;
  value?: unknown;
}

const CATEGORY_COMMENT_ITEM_ID = '__categoryComment';

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

function todayPrefix(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureActivityTable(adapter: MobileSqlAdapter): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS job_open_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_order_id TEXT NOT NULL,
      opened_at TEXT NOT NULL
    )
  `);
  await adapter.execute('CREATE INDEX IF NOT EXISTS idx_job_open_activity_opened_at ON job_open_activity (opened_at)');
}

function countTickedItems(resultsJson: string): number {
  try {
    const parsed = JSON.parse(resultsJson) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((result: ChecklistResult) => (
      result?.itemId !== CATEGORY_COMMENT_ITEM_ID && result?.value === true
    )).length;
  } catch {
    return 0;
  }
}

export async function recordJobOpened(jobOrderId: string): Promise<void> {
  const adapter = db();
  if (!adapter || !jobOrderId) return;

  await ensureActivityTable(adapter);
  await adapter.execute(
    'INSERT INTO job_open_activity (job_order_id, opened_at) VALUES (?, ?)',
    [jobOrderId, new Date().toISOString()],
  );
}

export async function loadTodayActivity(): Promise<TodayActivity> {
  const adapter = db();
  if (!adapter) {
    return { checklistItemsTicked: 0, observationsAdded: 0, jobsOpened: 0 };
  }

  await ensureActivityTable(adapter);
  const today = `${todayPrefix()}%`;
  const [checklists, observations, jobs] = await Promise.all([
    adapter.select<ChecklistRow>(
      `SELECT results_json
       FROM checklist_instance
       WHERE completed_at LIKE ?`,
      [today],
    ),
    adapter.select<CountRow>(
      `SELECT COUNT(*) AS n
       FROM observation
       WHERE created_at LIKE ?`,
      [today],
    ),
    adapter.select<CountRow>(
      `SELECT COUNT(DISTINCT job_order_id) AS n
       FROM job_open_activity
       WHERE opened_at LIKE ?`,
      [today],
    ),
  ]);

  return {
    checklistItemsTicked: checklists.reduce((total, row) => total + countTickedItems(row.results_json), 0),
    observationsAdded: Number(observations[0]?.n ?? 0),
    jobsOpened: Number(jobs[0]?.n ?? 0),
  };
}
