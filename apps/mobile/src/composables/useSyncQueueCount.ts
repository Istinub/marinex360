import { computed, ref } from 'vue';
import type { MobileSqlAdapter } from './useOfflineExecution.ts';

type ActionableQueueStatus = 'PENDING' | 'SYNCING' | 'CONFLICT' | 'ERROR';

interface StatusCountRow {
  status: ActionableQueueStatus;
  n: number | string;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

const COUNT_SQL = `
  SELECT status, COUNT(*) AS n
  FROM op_queue
  WHERE status IN ('PENDING','SYNCING','CONFLICT','ERROR')
  GROUP BY status
`;

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

const counts = ref<Record<ActionableQueueStatus, number>>({
  PENDING: 0,
  SYNCING: 0,
  CONFLICT: 0,
  ERROR: 0,
});

const totalActionable = computed(() => Object.values(counts.value).reduce((total, count) => total + count, 0));
const hasQueue = computed(() => totalActionable.value > 0);

async function loadCount(): Promise<void> {
  const adapter = db();
  const nextCounts: Record<ActionableQueueStatus, number> = {
    PENDING: 0,
    SYNCING: 0,
    CONFLICT: 0,
    ERROR: 0,
  };

  if (!adapter) {
    counts.value = nextCounts;
    return;
  }

  try {
    const rows = await adapter.select<StatusCountRow>(COUNT_SQL);
    for (const row of rows) nextCounts[row.status] = Number(row.n);
    counts.value = nextCounts;
  } catch {
    counts.value = nextCounts;
  }
}

export function useSyncQueueCount() {
  return {
    counts,
    totalActionable,
    hasQueue,
    loadCount,
  };
}
