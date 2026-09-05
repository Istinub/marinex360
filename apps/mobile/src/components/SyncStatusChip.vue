<script setup lang="ts">
import Button from 'primevue/button';
import { defineStore } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

type ActionableQueueStatus = 'PENDING' | 'SYNCING' | 'CONFLICT' | 'ERROR';

interface StatusCountRow {
  status: ActionableQueueStatus;
  n: number | string;
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
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

const REFRESH_MS = 5000;

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

const useSyncStatusChipStore = defineStore('syncStatusChip', () => {
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
    if (!adapter) {
      counts.value = { PENDING: 0, SYNCING: 0, CONFLICT: 0, ERROR: 0 };
      return;
    }

    const nextCounts: Record<ActionableQueueStatus, number> = {
      PENDING: 0,
      SYNCING: 0,
      CONFLICT: 0,
      ERROR: 0,
    };

    try {
      const rows = await adapter.select<StatusCountRow>(COUNT_SQL);
      for (const row of rows) nextCounts[row.status] = Number(row.n);
      counts.value = nextCounts;
    } catch {
      counts.value = nextCounts;
    }
  }

  return {
    counts,
    totalActionable,
    hasQueue,
    loadCount,
  };
});

const syncChipStore = useSyncStatusChipStore();
const router = useRouter();
let refreshTimer: number | null = null;

function openPanel(): void {
  void router.push('/sync');
}

onMounted(() => {
  void syncChipStore.loadCount();

  if (typeof window !== 'undefined') {
    refreshTimer = window.setInterval(() => {
      void syncChipStore.loadCount();
    }, REFRESH_MS);
  }
});

onBeforeUnmount(() => {
  if (refreshTimer != null && typeof window !== 'undefined') window.clearInterval(refreshTimer);
});
</script>

<template>
  <Button
    v-if="syncChipStore.hasQueue"
    class="sync-chip"
    icon="pi pi-cloud-upload"
    :label="String(syncChipStore.totalActionable)"
    rounded
    severity="warn"
    :aria-label="`Open sync status, ${syncChipStore.totalActionable} queued`"
    @click="openPanel"
  />

</template>

<style scoped>
.sync-chip {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  font-family: var(--font-ui);
  font-weight: var(--fw-semibold);
}

.sync-chip :deep(.p-button-label) {
  min-width: var(--sp-4);
}

</style>
