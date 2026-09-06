<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Textarea from 'primevue/textarea';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import {
  deleteUnsyncedLocalEntry,
  listLocalChecklists,
  updateLocalChecklist,
  type LocalChecklistEntry,
} from '@/composables/useLocalExecutionEntries';
import {
  useOfflineExecution,
  type ChecklistItemDef,
  type ChecklistItemResult,
} from '@/composables/useOfflineExecution';
import {
  loadChecklistCategories,
  type ChecklistCategory,
} from '@/composables/useChecklistCategories';

const CATEGORY_COMMENT_ITEM_ID = '__categoryComment';

interface ChecklistTemplateOption {
  id: string;
  name: string;
  items: ChecklistItemDef[];
}

const route = useRoute();
const offlineExecution = useOfflineExecution();

const selectedCategory = ref<string | null>(null);
const categories = ref<ChecklistCategory[]>([]);
const isLoading = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const savedChecklists = ref<LocalChecklistEntry[]>([]);
const editingEntry = ref<LocalChecklistEntry | null>(null);
const hasSubmittedChecklist = ref(false);
const checkedItems = reactive<Record<string, boolean>>({});
const categoryComment = ref('');

const jobOrderId = computed(() => {
  const id = route.params.id ?? route.params.jobOrderId;
  return (Array.isArray(id) ? id[0] : id) ?? '';
});

const selectedTemplate = computed<ChecklistTemplateOption | null>(() => {
  if (!selectedCategory.value) return null;
  const option = categories.value.find((category) => category.id === selectedCategory.value);
  return {
    id: `fixed-${selectedCategory.value}`,
    name: `${option?.name ?? selectedCategory.value} checklist`,
    items: option?.items.map((item) => ({ id: item.id, label: item.label })) ?? [],
  };
});

const submitButtonLabel = computed(() => (editingEntry.value ? 'Update checklist' : 'Submit checklist'));

function resetItemState(template: ChecklistTemplateOption | null): void {
  for (const key of Object.keys(checkedItems)) delete checkedItems[key];

  for (const item of template?.items ?? []) {
    checkedItems[item.id] = false;
  }
  categoryComment.value = '';
}

function clearForm(): void {
  resetItemState(selectedTemplate.value);
  editingEntry.value = null;
}

function applyResultsToForm(results: ChecklistItemResult[]): void {
  resetItemState(selectedTemplate.value);
  const itemIds = new Set(selectedTemplate.value?.items.map((item) => item.id) ?? []);

  for (const result of results) {
    if (result.itemId === CATEGORY_COMMENT_ITEM_ID) {
      categoryComment.value = typeof result.value === 'string' ? result.value : '';
      continue;
    }

    if (itemIds.has(result.itemId)) {
      checkedItems[result.itemId] = result.value === true;
    }
  }
}

function categoryFromTemplateId(templateId: string): string | null {
  const value = templateId.replace(/^fixed-/, '');
  const match = categories.value.find((category) => category.id === value);
  return match?.id ?? null;
}

function checklistResults(entry: LocalChecklistEntry): ChecklistItemResult[] {
  return entry.results.filter((result) => result.itemId !== CATEGORY_COMMENT_ITEM_ID);
}

function checklistComment(entry: LocalChecklistEntry): string {
  const comment = entry.results.find((result) => result.itemId === CATEGORY_COMMENT_ITEM_ID)?.value;
  return typeof comment === 'string' ? comment : '';
}

function checkedCount(entry: LocalChecklistEntry): number {
  return checklistResults(entry).filter((result) => result.value === true).length;
}

function totalCount(entry: LocalChecklistEntry): number {
  return checklistResults(entry).length;
}

function categoryLabel(templateId: string): string {
  const category = categoryFromTemplateId(templateId);
  return categories.value.find((option) => option.id === category)?.name ?? 'Checklist';
}

function buildResults(): ChecklistItemResult[] | null {
  const template = selectedTemplate.value;
  if (!template) {
    errorMessage.value = 'Select a checklist.';
    return null;
  }

  const results: ChecklistItemResult[] = template.items.map((item) => ({
    itemId: item.id,
    value: checkedItems[item.id] === true,
  }));
  const comment = categoryComment.value.trim();
  if (comment) results.push({ itemId: CATEGORY_COMMENT_ITEM_ID, value: comment });
  return results;
}

async function loadTemplates(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;

  try {
    categories.value = await loadChecklistCategories();
    selectedCategory.value ??= categories.value[0]?.id ?? null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load checklist templates.';
  } finally {
    isLoading.value = false;
  }
}

async function refreshEntries(): Promise<void> {
  savedChecklists.value = await listLocalChecklists(jobOrderId.value);
}

async function submitChecklist(): Promise<void> {
  errorMessage.value = null;
  successMessage.value = null;

  const template = selectedTemplate.value;
  const results = buildResults();
  if (!template || !results) return;

  isSubmitting.value = true;
  try {
    if (editingEntry.value) {
      await updateLocalChecklist(editingEntry.value, jobOrderId.value, results);
      successMessage.value = 'Checklist updated.';
    } else {
      await offlineExecution.authorChecklistSubmit(jobOrderId.value, template.id, results);
      successMessage.value = 'Checklist queued.';
    }
    await refreshEntries();
    hasSubmittedChecklist.value = true;
    clearForm();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to queue checklist.';
  } finally {
    isSubmitting.value = false;
  }
}

async function editChecklist(entry: LocalChecklistEntry): Promise<void> {
  const category = categoryFromTemplateId(entry.templateId);
  if (category) selectedCategory.value = category;
  editingEntry.value = entry;
  successMessage.value = null;
  errorMessage.value = null;
  await nextTick();
  applyResultsToForm(entry.results);
  hasSubmittedChecklist.value = true;
}

async function deleteChecklist(entry: LocalChecklistEntry): Promise<void> {
  try {
    await deleteUnsyncedLocalEntry('ChecklistInstance', entry.id);
    if (editingEntry.value?.id === entry.id) clearForm();
    successMessage.value = 'Checklist deleted.';
    await refreshEntries();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to delete checklist.';
  }
}

watch(selectedTemplate, (template) => {
  resetItemState(template);
}, { immediate: true });

onMounted(() => {
  void loadTemplates();
  void refreshEntries().catch((error) => {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load saved checklists.';
  });
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
        aria-label="Refresh checklist templates"
        rounded
        severity="secondary"
        :loading="isLoading"
        @click="loadTemplates"
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

    <form v-else-if="selectedTemplate" class="checklist-execution__form" @submit.prevent="submitChecklist">
      <section class="checklist-execution__categories" aria-label="Checklist category">
        <span class="checklist-execution__category-label">Category</span>
        <div class="checklist-execution__category-list">
          <Button
            v-for="category in categories"
            :key="category.id"
            type="button"
            :label="category.name"
            :severity="selectedCategory === category.id ? undefined : 'secondary'"
            :outlined="selectedCategory !== category.id"
            @click="selectedCategory = category.id"
          />
        </div>
      </section>

      <section class="checklist-execution__items" aria-label="Checklist items">
        <label
          v-for="item in selectedTemplate.items"
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

      <label class="checklist-execution__comment">
        <span>Category comment</span>
        <Textarea
          v-model="categoryComment"
          class="checklist-execution__input"
          rows="4"
          auto-resize
          placeholder="Optional notes for this checklist category"
        />
      </label>

      <Button
        type="submit"
        :label="submitButtonLabel"
        icon="pi pi-check"
        :loading="isSubmitting"
      />
    </form>

    <section v-if="hasSubmittedChecklist" class="checklist-execution__saved" aria-labelledby="saved-checklists-title">
      <h2 id="saved-checklists-title">Saved this session</h2>
      <p v-if="savedChecklists.length === 0" class="checklist-execution__empty">No checklist responses saved yet.</p>
      <article v-for="entry in savedChecklists" :key="entry.id" class="checklist-execution__saved-entry">
        <div>
          <strong>{{ categoryLabel(entry.templateId) }}</strong>
          <span>
            {{ checkedCount(entry) }} of {{ totalCount(entry) }} checked · {{ entry.syncState }}
          </span>
          <span v-if="checklistComment(entry)" class="checklist-execution__saved-comment">
            {{ checklistComment(entry) }}
          </span>
        </div>
        <div class="checklist-execution__saved-actions">
          <Button type="button" label="Edit" severity="secondary" outlined @click="editChecklist(entry)" />
          <Button type="button" label="Delete" severity="secondary" outlined @click="deleteChecklist(entry)" />
        </div>
      </article>
    </section>
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
.checklist-execution__categories,
.checklist-execution__items,
.checklist-execution__comment,
.checklist-execution__saved,
.checklist-execution__saved-entry,
.checklist-execution__saved-actions {
  display: grid;
  gap: var(--sp-3);
}

.checklist-execution__form {
  margin-top: var(--sp-4);
  gap: var(--sp-4);
}

.checklist-execution__category-label,
.checklist-execution__comment span {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.checklist-execution__category-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.checklist-execution__category-list :deep(.p-button) {
  min-height: var(--tap-min);
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

.checklist-execution__input {
  width: 100%;
  min-height: var(--tap-field);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}

.checklist-execution__form > :deep(.p-button) {
  min-height: var(--tap-field);
}

.checklist-execution__saved {
  margin-top: var(--sp-6);
}

.checklist-execution__saved h2 {
  margin: 0;
  font-size: var(--fs-h3);
}

.checklist-execution__saved-entry {
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.checklist-execution__saved-entry span,
.checklist-execution__empty {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

.checklist-execution__saved-comment {
  display: block;
  margin-top: var(--sp-1);
  line-height: var(--lh-base);
}

.checklist-execution__saved-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.checklist-execution__saved-actions :deep(.p-button) {
  min-height: var(--tap-min);
}

@media (min-width: 720px) {
  .checklist-execution {
    padding: var(--sp-6);
  }
}
</style>
