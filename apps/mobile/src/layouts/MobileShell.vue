<script setup lang="ts">
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import SyncStatusChip from '../components/SyncStatusChip.vue';
import { useOfflineExecution } from '../composables/useOfflineExecution';
import {
  createSyncTransport,
  currentSyncAuth,
  syncResultHasVersionConflict,
  useSyncEngine,
} from '../composables/useSyncEngine';

type ListenerHandle = {
  remove: () => Promise<void>;
};

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const syncEngine = useSyncEngine();
const offlineExecution = useOfflineExecution();
const isForegrounded = ref(true);
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
const isSyncing = ref(false);

let syncInterval: number | null = null;
let networkListener: ListenerHandle | null = null;
let appStateListener: ListenerHandle | null = null;

async function runSyncCycle(): Promise<void> {
  if (isSyncing.value || !isForegrounded.value || !isOnline.value) return;

  isSyncing.value = true;
  try {
    await offlineExecution.drainBinaryUploads();
    const result = await syncEngine.syncOnce(createSyncTransport(), currentSyncAuth());
    if (syncResultHasVersionConflict(result)) await syncEngine.reconcileConflicts();
  } catch {
    // Sync failures are persisted on op_queue/binary_upload rows for the status panel.
  } finally {
    isSyncing.value = false;
  }
}

async function refreshNetworkState(): Promise<void> {
  try {
    const status = await Network.getStatus();
    isOnline.value = status.connected;
  } catch {
    isOnline.value = typeof navigator === 'undefined' ? true : navigator.onLine;
  }
}

onMounted(() => {
  void refreshNetworkState();

  void Network.addListener('networkStatusChange', (status) => {
    const wasOnline = isOnline.value;
    isOnline.value = status.connected;
    if (!wasOnline && status.connected) void runSyncCycle();
  }).then((handle) => {
    networkListener = handle;
  }).catch(() => undefined);

  void App.addListener('appStateChange', (state) => {
    const wasForegrounded = isForegrounded.value;
    isForegrounded.value = state.isActive;
    if (!wasForegrounded && state.isActive) void runSyncCycle();
  }).then((handle) => {
    appStateListener = handle;
  }).catch(() => undefined);

  if (typeof window !== 'undefined') {
    syncInterval = window.setInterval(() => {
      void runSyncCycle();
    }, SYNC_INTERVAL_MS);
  }
});

onBeforeUnmount(() => {
  if (syncInterval != null && typeof window !== 'undefined') window.clearInterval(syncInterval);
  void networkListener?.remove();
  void appStateListener?.remove();
});
</script>

<template>
  <div class="mobile-shell">
    <header class="mobile-shell__topbar">
      <RouterLink class="mobile-shell__brand" to="/jobs" aria-label="MarineX360 jobs">
        <span class="mobile-shell__mark" aria-hidden="true">M</span>
        <span class="mobile-shell__brand-copy">
          <span class="mobile-shell__name">MarineX360</span>
          <span class="mobile-shell__context">Field</span>
        </span>
      </RouterLink>

      <div class="mobile-shell__actions">
        <SyncStatusChip />
      </div>
    </header>

    <section class="mobile-shell__content" aria-label="Mobile workspace">
      <RouterView />
    </section>
  </div>
</template>

<style scoped>
.mobile-shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.mobile-shell__topbar {
  min-height: calc(var(--tap-min) + var(--sp-3));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: max(var(--sp-2), env(safe-area-inset-top)) max(var(--sp-3), env(safe-area-inset-right)) var(--sp-2) max(var(--sp-3), env(safe-area-inset-left));
  border-bottom: var(--border-1);
  background: var(--color-surface);
}

.mobile-shell__brand,
.mobile-shell__actions {
  min-height: var(--tap-min);
  min-width: var(--tap-min);
  display: inline-flex;
  align-items: center;
}

.mobile-shell__brand {
  min-width: 0;
  gap: var(--sp-3);
  color: var(--color-text);
  text-decoration: none;
}

.mobile-shell__mark {
  width: var(--tap-min);
  height: var(--tap-min);
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  border: var(--border-2);
  border-color: var(--color-brand);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: var(--color-surface);
  font-size: var(--fs-h3);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
}

.mobile-shell__brand-copy {
  min-width: 0;
  display: grid;
  gap: var(--sp-1);
}

.mobile-shell__name {
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-shell__context {
  color: var(--color-text-muted);
  font-size: var(--fs-caption);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.mobile-shell__actions {
  justify-content: flex-end;
  gap: var(--tap-gap);
}

.mobile-shell__content {
  min-width: 0;
  min-height: 0;
  background: var(--color-canvas);
}
</style>
