<script setup lang="ts">
import Card from 'primevue/card';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, onMounted, ref } from 'vue';
import type { MobileSqlAdapter } from '@/composables/useOfflineExecution';

type JobState = string;

interface CacheSummaryRow {
  state: JobState;
  pulled_at: string;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

interface DashboardBucket {
  key: 'completed' | 'assigned' | 'pending';
  label: string;
  count: number;
  foreground: string;
  background: string;
}

const rows = ref<CacheSummaryRow[]>([]);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

async function loadCacheSummary(): Promise<void> {
  const db = mobileRuntime().marinex360?.db;
  if (!db) {
    rows.value = [];
    isLoading.value = false;
    errorMessage.value = 'Dashboard data is not available on this device.';
    return;
  }

  try {
    rows.value = await db.select<CacheSummaryRow>('SELECT state, pulled_at FROM jo_cache ORDER BY pulled_at DESC');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load dashboard data.';
  } finally {
    isLoading.value = false;
  }
}

const buckets = computed<DashboardBucket[]>(() => [
  {
    key: 'completed',
    label: 'Completed',
    count: rows.value.filter((row) => row.state === 'COMPLETED').length,
    foreground: 'var(--status-synced-fg)',
    background: 'var(--status-synced-bg)',
  },
  {
    key: 'assigned',
    label: 'Assigned',
    count: rows.value.filter((row) => row.state !== 'COMPLETED' && row.state !== 'PENDING_REVIEW').length,
    foreground: 'var(--color-field-action)',
    background: 'var(--status-pending-bg)',
  },
  {
    key: 'pending',
    label: 'Pending',
    count: rows.value.filter((row) => row.state === 'PENDING_REVIEW').length,
    foreground: 'var(--status-pending-fg)',
    background: 'var(--status-pending-bg)',
  },
]);

const totalCount = computed(() => rows.value.length);
const maxCount = computed(() => Math.max(1, ...buckets.value.map((bucket) => bucket.count)));
const lastUpdated = computed(() => {
  const latest = rows.value.map((row) => Date.parse(row.pulled_at)).filter((value) => Number.isFinite(value)).sort((a, b) => b - a)[0];
  return latest ? new Date(latest).toLocaleString() : 'Not available';
});

function barWidth(count: number): string {
  return `${Math.round((count / maxCount.value) * 100)}%`;
}

onMounted(() => {
  void loadCacheSummary();
});
</script>

<template>
  <main class="dashboard" aria-labelledby="dashboard-title">
    <header class="dashboard__header">
      <div>
        <p class="dashboard__eyebrow">Field snapshot</p>
        <h1 id="dashboard-title">Dashboard</h1>
      </div>
      <i class="pi pi-chart-bar dashboard__header-icon" aria-hidden="true" />
    </header>

    <div v-if="isLoading" class="dashboard__loading" aria-live="polite">
      <ProgressSpinner stroke-width="4" />
    </div>

    <template v-else>
      <p v-if="errorMessage" class="dashboard__message" role="alert">{{ errorMessage }}</p>

      <section class="dashboard__summary" aria-label="Job totals">
        <p class="dashboard__summary-label">Cached jobs</p>
        <strong class="dashboard__total">{{ totalCount }}</strong>
        <p class="dashboard__updated">Last updated {{ lastUpdated }}</p>
      </section>

      <section class="dashboard__charts" aria-label="Job status counts">
        <Card v-for="bucket in buckets" :key="bucket.key" class="dashboard__card">
          <template #content>
            <div class="dashboard__card-heading">
              <span class="dashboard__swatch" :style="{ background: bucket.foreground }" aria-hidden="true" />
              <h2>{{ bucket.label }}</h2>
              <strong>{{ bucket.count }}</strong>
            </div>
            <div class="dashboard__bar" role="img" :aria-label="`${bucket.label}: ${bucket.count} of ${totalCount} jobs`">
              <span class="dashboard__bar-fill" :style="{ width: barWidth(bucket.count), background: bucket.foreground }" />
            </div>
            <p class="dashboard__proportion">{{ totalCount ? Math.round((bucket.count / totalCount) * 100) : 0 }}% of cached jobs</p>
          </template>
        </Card>
      </section>

      <p class="dashboard__note">Counts are based on jobs currently stored on this device.</p>
    </template>
  </main>
</template>

<style scoped>
.dashboard {
  display: grid;
  gap: var(--sp-4);
  min-height: 100%;
  padding: var(--sp-4);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.dashboard__header,
.dashboard__card-heading {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.dashboard__header { justify-content: space-between; }
.dashboard__header h1 { margin: 0; font-size: var(--fs-h1); }
.dashboard__eyebrow { margin: 0 0 var(--sp-1); color: var(--color-text-muted); font-weight: var(--fw-semibold); }
.dashboard__header-icon { color: var(--color-field-action); font-size: var(--fs-h2); }
.dashboard__summary { padding: var(--sp-4); border: var(--border-1); border-radius: var(--radius-md); background: var(--color-surface); }
.dashboard__summary-label, .dashboard__updated, .dashboard__proportion, .dashboard__note { margin: 0; color: var(--color-text-muted); }
.dashboard__summary-label { font-size: var(--fs-body-sm); font-weight: var(--fw-semibold); }
.dashboard__total { display: block; margin: var(--sp-1) 0; font-size: var(--fs-display); line-height: var(--lh-tight); }
.dashboard__updated, .dashboard__proportion, .dashboard__note { font-size: var(--fs-body-sm); }
.dashboard__charts { display: grid; gap: var(--tap-gap); }
.dashboard__card { border: var(--border-1); background: var(--color-surface); }
.dashboard__card-heading h2 { flex: 1; margin: 0; font-size: var(--fs-body-lg); }
.dashboard__card-heading strong { font-size: var(--fs-h2); }
.dashboard__swatch { width: var(--sp-3); height: var(--sp-3); flex: 0 0 auto; border-radius: 50%; }
.dashboard__bar { height: var(--sp-3); overflow: hidden; margin-top: var(--sp-3); border-radius: var(--radius-pill); background: var(--jo-draft-bg); }
.dashboard__bar-fill { display: block; height: 100%; min-width: 0; border-radius: inherit; transition: width var(--motion-base) var(--ease); }
.dashboard__proportion { margin-top: var(--sp-2); }
.dashboard__loading { display: grid; min-height: var(--tap-field); place-items: center; padding: var(--sp-8); }
.dashboard__loading :deep(.p-progressspinner) { width: var(--tap-min); height: var(--tap-min); }
.dashboard__message { margin: 0; padding: var(--sp-3); border: var(--border-1); border-color: var(--status-error-br); background: var(--status-error-bg); color: var(--status-error-fg); }
</style>