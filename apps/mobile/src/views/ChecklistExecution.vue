<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import {
  loadJobOrderChecklistItems,
  updateJobOrderChecklistItem,
  type JobOrderChecklistItem,
} from '@/composables/useJobOrders';

const route = useRoute();

const items = ref<JobOrderChecklistItem[]>([]);
const checkedItems = reactive<Record<string, boolean>>({});
const isLoading = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const jobOrderId = computed(() => {
  const id = route.params.id ?? route.params.jobOrderId;
  return (Array.isArray(id) ? id[0] : id) ?? '';
});

const checkedCount = computed(() => items.value.filter((item) => checkedItems[item.id] === true).length);

function applyItems(nextItems: JobOrderChecklistItem[]): void {
  items.value = nextItems;
  for (const key of Object.keys(checkedItems)) delete checkedItems[key];
  for (const item of nextItems) checkedItems[item.id] = item.checked;
}

async function loadItems(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    applyItems(await loadJobOrderChecklistItems(jobOrderId.value));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load checklist items.';
  } finally {
    isLoading.value = false;
  }
}

async function submitChecklist(): Promise<void> {
  isSubmitting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const changed = items.value.filter((item) => item.checked !== (checkedItems[item.id] === true));
    await Promise.all(changed.map((item) => updateJobOrderChecklistItem(jobOrderId.value, item.id, checkedItems[item.id] === true)));
    applyItems(await loadJobOrderChecklistItems(jobOrderId.value));
    successMessage.value = 'Checklist saved.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to save checklist.';
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  void loadItems();
});
</script>

<template>
  <main class="checklist-execution" aria-labelledby="checklist-title">
    <header class="checklist-execution__header">
      <div>
        <MobileBackLink :to="`/jobs/${jobOrderId}`" label="Return" />
        <p class="checklist-execution__eyebrow">Checklist</p>
        <h1 id="checklist-title" class="checklist-execution__title">Execute checklist</h1>
      </div>

      <Button
        class="checklist-execution__refresh"
        icon="pi pi-refresh"
        aria-label="Refresh checklist"
        rounded
        severity="secondary"
        :loading="isLoading"
        @click="loadItems"
      />
    </header>

    <Message v-if="errorMessage" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>
    <Message v-if="successMessage" severity="success" :closable="false">
      {{ successMessage }}
    </Message>

    <div v-if="isLoading" class="checklist-execution__loading" aria-live="polite">
      <ProgressSpinner class="checklist-execution__spinner" stroke-width="4" />
    </div>

    <form v-else class="checklist-execution__form" @submit.prevent="submitChecklist">
      <section class="checklist-execution__items" aria-label="Checklist items">
        <p v-if="items.length === 0" class="checklist-execution__empty">
          No checklist items have been added to this job yet.
        </p>
        <label
          v-for="item in items"
          :key="item.id"
          class="checklist-execution__tick-item"
        >
          <input
            v-model="checkedItems[item.id]"
            class="checklist-execution__checkbox"
            type="checkbox"
          />
          <span>{{ item.label }}</span>
        </label>
      </section>

      <div class="checklist-execution__footer">
        <span>{{ checkedCount }} of {{ items.length }} checked</span>
        <Button
          type="submit"
          label="Save checklist"
          icon="pi pi-check"
          :loading="isSubmitting"
        />
      </div>
    </form>
  </main>
</template>

<style scoped>
.checklist-execution {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.checklist-execution__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-4);
}

.checklist-execution__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.checklist-execution__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.checklist-execution__refresh,
.checklist-execution__spinner {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
}

.checklist-execution__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-8);
}

.checklist-execution__form,
.checklist-execution__items {
  display: grid;
  gap: var(--sp-3);
}

.checklist-execution__form {
  margin-top: var(--sp-4);
  gap: var(--sp-4);
}

.checklist-execution__items {
  padding: var(--sp-3);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.checklist-execution__tick-item {
  display: grid;
  grid-template-columns: var(--tap-min) minmax(0, 1fr);
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--tap-field);
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.checklist-execution__checkbox {
  width: 1.35rem;
  height: 1.35rem;
  justify-self: center;
  accent-color: var(--color-brand);
}

.checklist-execution__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

.checklist-execution__footer :deep(.p-button) {
  min-height: var(--tap-field);
}

.checklist-execution__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

@media (min-width: 720px) {
  .checklist-execution {
    padding: var(--sp-6);
  }
}
</style>
