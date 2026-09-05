<script setup lang="ts">
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
  JOB_ORDER_CATEGORY_OPTIONS,
  checklistItemsForCategory,
  type JobOrderCategory,
} from '@/lib/checklistCategoryTemplates';

interface ChecklistTemplateOption {
  id: string;
  name: string;
  items: ChecklistItemDef[];
}

async function captureGeo(): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch {
    return { lat: null, lng: null };
  }
}

const route = useRoute();
const offlineExecution = useOfflineExecution();

const selectedCategory = ref<JobOrderCategory | null>(null);
const isLoading = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const savedChecklists = ref<LocalChecklistEntry[]>([]);
const editingEntry = ref<LocalChecklistEntry | null>(null);
const fieldErrors = reactive<Record<string, string>>({});

const boolValues = reactive<Record<string, boolean>>({});
const textValues = reactive<Record<string, string>>({});
const numberValues = reactive<Record<string, number | null>>({});
const selectValues = reactive<Record<string, string | null>>({});
const photoOpIds = reactive<Record<string, string | null>>({});
const naValues = reactive<Record<string, boolean>>({});

const jobOrderId = computed(() => {
  const id = route.params.id ?? route.params.jobOrderId;
  return (Array.isArray(id) ? id[0] : id) ?? '';
});

const selectedTemplate = computed<ChecklistTemplateOption | null>(() => {
  if (!selectedCategory.value) return null;
  const option = JOB_ORDER_CATEGORY_OPTIONS.find((category) => category.value === selectedCategory.value);
  return {
    id: `fixed-${selectedCategory.value}`,
    name: `${option?.label ?? selectedCategory.value} checklist`,
    items: checklistItemsForCategory(selectedCategory.value),
  };
});

function resetItemState(template: ChecklistTemplateOption | null): void {
  for (const key of Object.keys(boolValues)) delete boolValues[key];
  for (const key of Object.keys(textValues)) delete textValues[key];
  for (const key of Object.keys(numberValues)) delete numberValues[key];
  for (const key of Object.keys(selectValues)) delete selectValues[key];
  for (const key of Object.keys(photoOpIds)) delete photoOpIds[key];
  for (const key of Object.keys(naValues)) delete naValues[key];
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];

  for (const item of template?.items ?? []) {
    boolValues[item.id] = false;
    textValues[item.id] = '';
    numberValues[item.id] = null;
    selectValues[item.id] = null;
    photoOpIds[item.id] = null;
    naValues[item.id] = false;
  }
}

function clearForm(): void {
  resetItemState(selectedTemplate.value);
  editingEntry.value = null;
}

function applyResultsToForm(results: ChecklistItemResult[]): void {
  resetItemState(selectedTemplate.value);
  const items = selectedTemplate.value?.items ?? [];
  for (const result of results) {
    const item = items.find((candidate) => candidate.id === result.itemId);
    if (!item) continue;

    naValues[item.id] = Boolean(result.na);
    if (result.photoOpId) photoOpIds[item.id] = result.photoOpId;
    if (result.na) continue;

    switch (item.type) {
      case 'bool':
        boolValues[item.id] = Boolean(result.value);
        break;
      case 'text':
        textValues[item.id] = typeof result.value === 'string' ? result.value : '';
        break;
      case 'number':
        numberValues[item.id] = typeof result.value === 'number' ? result.value : null;
        break;
      case 'select':
        selectValues[item.id] = typeof result.value === 'string' ? result.value : null;
        break;
      case 'photo':
        break;
    }
  }
}

function categoryFromTemplateId(templateId: string): JobOrderCategory | null {
  const value = templateId.replace(/^fixed-/, '');
  const match = JOB_ORDER_CATEGORY_OPTIONS.find((category) => category.value === value);
  return match?.value ?? null;
}

function itemLabel(templateId: string, result: ChecklistItemResult | undefined): string {
  const category = categoryFromTemplateId(templateId);
  const item = category && result ? checklistItemsForCategory(category).find((candidate) => candidate.id === result.itemId) : null;
  return item?.label ?? result?.itemId ?? 'Checklist response';
}

function answerText(result: ChecklistItemResult | undefined): string {
  if (!result) return 'No answer';
  if (result.na) return 'N/A';
  if (result.photoOpId) return 'Photo queued';
  if (typeof result.value === 'boolean') return result.value ? 'Yes' : 'No';
  return String(result.value ?? 'No answer');
}

function valueFor(item: ChecklistItemDef): boolean | string | number | null {
  if (naValues[item.id]) return null;

  switch (item.type) {
    case 'bool':
      return boolValues[item.id] ?? false;
    case 'text':
      return textValues[item.id]?.trim() || null;
    case 'number':
      return numberValues[item.id] ?? null;
    case 'select':
      return selectValues[item.id] ?? null;
    case 'photo':
      return null;
  }
}

function buildResults(): ChecklistItemResult[] | null {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];

  const template = selectedTemplate.value;
  if (!template) {
    errorMessage.value = 'Select a checklist.';
    return null;
  }

  const results: ChecklistItemResult[] = [];
  for (const item of template.items) {
    if (naValues[item.id]) {
      results.push({ itemId: item.id, value: null, na: true });
      continue;
    }

    if (item.type === 'photo') {
      const photoOpId = photoOpIds[item.id];
      if (item.required && !photoOpId) fieldErrors[item.id] = 'Capture a photo for this item.';
      results.push({ itemId: item.id, value: null, ...(photoOpId ? { photoOpId } : {}) });
      continue;
    }

    const value = valueFor(item);
    const missing = value == null || (typeof value === 'string' && value.length === 0);
    if (item.required && missing) fieldErrors[item.id] = 'This item is required.';
    results.push({ itemId: item.id, value });
  }

  return Object.keys(fieldErrors).length > 0 ? null : results;
}

async function loadTemplates(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;

  try {
    selectedCategory.value ??= JOB_ORDER_CATEGORY_OPTIONS[0]?.value ?? null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load checklist templates.';
  } finally {
    isLoading.value = false;
  }
}

async function refreshEntries(): Promise<void> {
  savedChecklists.value = await listLocalChecklists(jobOrderId.value);
}

async function capturePhotoFor(item: ChecklistItemDef): Promise<void> {
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
    });
    const localPath = photo.path ?? photo.webPath;
    if (!localPath) throw new Error('Camera did not return a local photo path.');

    const geo = await captureGeo();
    const queued = await offlineExecution.authorPhotoCapture(jobOrderId.value, 'DURING', localPath, geo.lat, geo.lng);
    photoOpIds[item.id] = queued.opId;
    delete fieldErrors[item.id];
    successMessage.value = 'Photo queued for this checklist item.';
  } catch (error) {
    fieldErrors[item.id] = error instanceof Error ? error.message : 'Unable to capture photo.';
  }
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
    clearForm();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to queue checklist.';
  } finally {
    isSubmitting.value = false;
  }
}

function editChecklist(entry: LocalChecklistEntry): void {
  const category = categoryFromTemplateId(entry.templateId);
  if (category) selectedCategory.value = category;
  editingEntry.value = entry;
  successMessage.value = null;
  errorMessage.value = null;
  applyResultsToForm(entry.results);
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

watch(selectedTemplate, (template) => resetItemState(template), { immediate: true });

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
            v-for="category in JOB_ORDER_CATEGORY_OPTIONS"
            :key="category.value"
            type="button"
            :label="category.label"
            :severity="selectedCategory === category.value ? undefined : 'secondary'"
            :outlined="selectedCategory !== category.value"
            @click="selectedCategory = category.value"
          />
        </div>
      </section>

      <section class="checklist-execution__items" aria-label="Checklist items">
        <article v-for="item in selectedTemplate.items" :key="item.id" class="checklist-execution__item">
          <header class="checklist-execution__item-header">
            <div>
              <h2 class="checklist-execution__item-title">{{ item.label }}</h2>
              <p v-if="item.type === 'number' && item.unit" class="checklist-execution__item-meta">{{ item.unit }}</p>
            </div>
            <Tag v-if="item.required" value="Required" severity="info" />
          </header>

          <label class="checklist-execution__na">
            <Checkbox v-model="naValues[item.id]" binary />
            <span>Not applicable</span>
          </label>

          <div v-if="!naValues[item.id]" class="checklist-execution__control">
            <ToggleSwitch v-if="item.type === 'bool'" v-model="boolValues[item.id]" />

            <InputText
              v-else-if="item.type === 'text'"
              v-model="textValues[item.id]"
              class="checklist-execution__input"
              autocomplete="off"
            />

            <InputNumber
              v-else-if="item.type === 'number'"
              v-model="numberValues[item.id]"
              class="checklist-execution__input"
              :input-id="`number-item-${item.id}`"
              :min-fraction-digits="0"
              :max-fraction-digits="3"
            />

            <Select
              v-else-if="item.type === 'select'"
              v-model="selectValues[item.id]"
              class="checklist-execution__input"
              :options="item.options ?? []"
            />

            <div v-else-if="item.type === 'photo'" class="checklist-execution__photo">
              <Button
                type="button"
                icon="pi pi-camera"
                :label="photoOpIds[item.id] ? 'Photo queued' : 'Capture photo'"
                severity="secondary"
                @click="capturePhotoFor(item)"
              />
              <span v-if="photoOpIds[item.id]" class="checklist-execution__photo-op">
                {{ photoOpIds[item.id] }}
              </span>
            </div>
          </div>

          <small v-if="fieldErrors[item.id]" class="checklist-execution__error">
            {{ fieldErrors[item.id] }}
          </small>
        </article>
      </section>

      <Button type="submit" :label="editingEntry ? 'Update' : 'Submit checklist'" icon="pi pi-check" :loading="isSubmitting" />
    </form>

    <section class="checklist-execution__saved" aria-labelledby="saved-checklists-title">
      <h2 id="saved-checklists-title">Saved this session</h2>
      <p v-if="savedChecklists.length === 0" class="checklist-execution__empty">No checklist responses saved yet.</p>
      <article v-for="entry in savedChecklists" :key="entry.id" class="checklist-execution__saved-entry">
        <div>
          <strong>{{ itemLabel(entry.templateId, entry.results[0]) }}</strong>
          <span>{{ answerText(entry.results[0]) }} · {{ entry.syncState }}</span>
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
.checklist-execution__items,
.checklist-execution__item,
.checklist-execution__field,
.checklist-execution__control,
.checklist-execution__categories,
.checklist-execution__saved,
.checklist-execution__saved-entry,
.checklist-execution__saved-actions,
.checklist-execution__photo {
  display: grid;
  gap: var(--sp-3);
}

.checklist-execution__form {
  margin-top: var(--sp-4);
  gap: var(--sp-4);
}

.checklist-execution__item {
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.checklist-execution__category-label {
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

.checklist-execution__item-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.checklist-execution__item-title {
  margin: 0;
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.checklist-execution__item-meta,
.checklist-execution__photo-op {
  margin: var(--sp-1) 0 0;
  color: var(--color-text-muted);
  font-family: var(--font-code);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
  word-break: break-all;
}

.checklist-execution__field span,
.checklist-execution__na {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.checklist-execution__na {
  min-height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  gap: var(--tap-gap);
}

.checklist-execution__input {
  width: 100%;
  min-height: var(--tap-field);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}

.checklist-execution__photo :deep(.p-button),
.checklist-execution__form > :deep(.p-button) {
  min-height: var(--tap-field);
}

.checklist-execution__error {
  color: var(--status-error-fg);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
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
