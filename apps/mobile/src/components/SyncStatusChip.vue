<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSyncQueueCount } from '@/composables/useSyncQueueCount';

const REFRESH_MS = 5000;
const syncChipStore = useSyncQueueCount();
const router = useRouter();
const queuedCount = computed(() => syncChipStore.totalActionable.value);
const hasQueue = computed(() => syncChipStore.hasQueue.value);
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
    v-if="hasQueue"
    class="sync-chip"
    icon="pi pi-cloud-upload"
    :label="String(queuedCount)"
    rounded
    severity="warn"
    :aria-label="`Open sync status, ${queuedCount} queued`"
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
