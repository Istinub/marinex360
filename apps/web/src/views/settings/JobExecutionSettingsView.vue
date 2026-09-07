<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { ChecklistCategory, ChecklistTemplate, ChecklistTemplateItem } from '@/lib/api/types';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';

type TemplateEntryDraft = { id?: string; label: string; sortOrder: number };

const store = useChecklistCategoriesStore();
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const isSaving = ref(false);
const selectedCategoryId = ref<string | null>(null);
const showCategoryDialog = ref(false);
const showItemDialog = ref(false);
const showTemplateDialog = ref(false);
const templateEntryDraft = ref('');
const categoryForm = reactive({ id: null as string | null, name: '', sortOrder: 0 });
const itemForm = reactive({ id: null as string | null, label: '', sortOrder: 0 });
const templateForm = reactive({
  id: null as string | null,
  name: '',
  categoryId: '',
  entries: [] as TemplateEntryDraft[],
  originalEntryIds: [] as string[],
});

const selectedCategory = computed(() =>
  store.sortedCategories.find((category) => category.id === selectedCategoryId.value) ?? store.sortedCategories[0] ?? null);
const categoryDialogTitle = computed(() => categoryForm.id ? 'Edit category' : 'Add category');
const itemDialogTitle = computed(() => itemForm.id ? 'Edit item' : 'Add item');
const templateDialogTitle = computed(() => templateForm.id ? 'Edit template' : 'Add template');
const categoryNameById = computed(() => new Map(store.sortedCategories.map((category) => [category.id, category.name])));

async function load(): Promise<void> {
  errorMessage.value = null;
  try {
    await Promise.all([store.load(true), store.loadTemplates(true)]);
    selectedCategoryId.value ??= store.sortedCategories[0]?.id ?? null;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load job execution settings.';
  }
}

function categoryLabel(categoryId?: string | null): string {
  if (!categoryId) return 'Independent';
  return categoryNameById.value.get(categoryId) ?? categoryId;
}

function openCategoryCreate(): void {
  categoryForm.id = null;
  categoryForm.name = '';
  categoryForm.sortOrder = (store.sortedCategories.at(-1)?.sortOrder ?? 0) + 10;
  showCategoryDialog.value = true;
}

function openCategoryEdit(category: ChecklistCategory): void {
  categoryForm.id = category.id;
  categoryForm.name = category.name;
  categoryForm.sortOrder = category.sortOrder;
  showCategoryDialog.value = true;
}

function selectCategory(event: { data: ChecklistCategory }): void {
  selectedCategoryId.value = event.data.id;
}

function openItemCreate(): void {
  itemForm.id = null;
  itemForm.label = '';
  itemForm.sortOrder = (selectedCategory.value?.items.at(-1)?.sortOrder ?? 0) + 10;
  showItemDialog.value = true;
}

function openItemEdit(item: ChecklistTemplateItem): void {
  itemForm.id = item.id;
  itemForm.label = item.label;
  itemForm.sortOrder = item.sortOrder;
  showItemDialog.value = true;
}

function resetTemplateForm(template?: ChecklistTemplate): void {
  const entries: TemplateEntryDraft[] = template?.entries ?? [];
  templateForm.id = template?.id ?? null;
  templateForm.name = template?.name ?? '';
  templateForm.categoryId = template?.categoryId ?? '';
  templateEntryDraft.value = '';
  templateForm.entries = entries
    .map((entry, index) => ({
      id: entry.id,
      label: entry.label,
      sortOrder: entry.sortOrder ?? (index + 1) * 10,
    }));
  templateForm.originalEntryIds = (template?.entries ?? []).map((entry) => entry.id);
}

function openTemplateCreate(): void {
  resetTemplateForm();
  showTemplateDialog.value = true;
}

function openTemplateEdit(template: ChecklistTemplate): void {
  resetTemplateForm(template);
  showTemplateDialog.value = true;
}

function addTemplateEntry(): void {
  const label = templateEntryDraft.value.trim();
  if (!label) return;
  templateForm.entries.push({ label, sortOrder: (templateForm.entries.length + 1) * 10 });
  templateEntryDraft.value = '';
}

function removeTemplateEntry(index: number): void {
  templateForm.entries.splice(index, 1);
  templateForm.entries.forEach((item, itemIndex) => {
    item.sortOrder = (itemIndex + 1) * 10;
  });
}

function moveTemplateEntry(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= templateForm.entries.length) return;
  const [entry] = templateForm.entries.splice(index, 1);
  templateForm.entries.splice(nextIndex, 0, entry);
  templateForm.entries.forEach((item, itemIndex) => {
    item.sortOrder = (itemIndex + 1) * 10;
  });
}

function normalizeTemplateEntries(): TemplateEntryDraft[] {
  return templateForm.entries
    .map((entry, index) => ({ id: entry.id, label: entry.label.trim(), sortOrder: (index + 1) * 10 }))
    .filter((entry) => entry.label.length > 0);
}

async function saveCategory(): Promise<void> {
  if (!categoryForm.name.trim()) {
    errorMessage.value = 'Category name is required.';
    return;
  }
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    if (categoryForm.id) {
      await store.updateCategory(categoryForm.id, { name: categoryForm.name.trim(), sortOrder: categoryForm.sortOrder });
      successMessage.value = 'Category updated.';
    } else {
      const category = await store.createCategory({ name: categoryForm.name.trim(), sortOrder: categoryForm.sortOrder });
      selectedCategoryId.value = category.id;
      successMessage.value = 'Category created.';
    }
    showCategoryDialog.value = false;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save category.';
  } finally {
    isSaving.value = false;
  }
}

async function removeCategory(category: ChecklistCategory): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await store.deleteCategory(category.id);
    selectedCategoryId.value = store.sortedCategories[0]?.id ?? null;
    await store.loadTemplates(true);
    successMessage.value = 'Category removed.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to remove category.';
  } finally {
    isSaving.value = false;
  }
}

async function saveItem(): Promise<void> {
  const category = selectedCategory.value;
  if (!category) return;
  if (!itemForm.label.trim()) {
    errorMessage.value = 'Item label is required.';
    return;
  }
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    if (itemForm.id) {
      await store.updateItem(category.id, itemForm.id, { label: itemForm.label.trim(), sortOrder: itemForm.sortOrder });
      successMessage.value = 'Item updated.';
    } else {
      await store.createItem(category.id, { label: itemForm.label.trim(), sortOrder: itemForm.sortOrder });
      successMessage.value = 'Item added.';
    }
    await store.loadTemplates(true);
    showItemDialog.value = false;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save item.';
  } finally {
    isSaving.value = false;
  }
}

async function removeItem(item: ChecklistTemplateItem): Promise<void> {
  const category = selectedCategory.value;
  if (!category) return;
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await store.deleteItem(category.id, item.id);
    await store.loadTemplates(true);
    successMessage.value = 'Item removed.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to remove item.';
  } finally {
    isSaving.value = false;
  }
}

async function saveTemplate(): Promise<void> {
  const name = templateForm.name.trim();
  const entries = normalizeTemplateEntries();
  if (!name) {
    errorMessage.value = 'Template name is required.';
    return;
  }
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    if (templateForm.id) {
      const updated = await store.updateTemplate(templateForm.id, { name, categoryId: templateForm.categoryId || null });
      const currentIds = new Set(entries.map((entry) => entry.id).filter((id): id is string => Boolean(id)));
      for (const entryId of templateForm.originalEntryIds) {
        if (!currentIds.has(entryId)) await store.deleteTemplateEntry(updated.id, entryId);
      }
      for (const entry of entries) {
        if (entry.id) {
          await store.updateTemplateEntry(updated.id, entry.id, { label: entry.label, sortOrder: entry.sortOrder });
        } else {
          await store.createTemplateEntry(updated.id, { label: entry.label, sortOrder: entry.sortOrder });
        }
      }
      successMessage.value = 'Template updated.';
    } else {
      await store.createTemplate({ name, categoryId: templateForm.categoryId || null, entries });
      successMessage.value = 'Template created.';
    }
    showTemplateDialog.value = false;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save template.';
  } finally {
    isSaving.value = false;
  }
}

async function removeTemplate(template: ChecklistTemplate): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await store.deleteTemplate(template.id);
    successMessage.value = 'Template removed.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to remove template.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="job-execution-settings-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Settings</p>
        <h1 id="job-execution-settings-title" class="crm-page__title">Job Execution Settings</h1>
        <p class="record-form__version">Manage technician checklist setup for mobile job execution.</p>
      </div>
    </header>

    <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
    <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>

    <section class="settings-execution__panel" aria-labelledby="checklist-categories-title">
      <div class="settings-execution__panel-header">
        <div>
          <h2 id="checklist-categories-title" class="crm-section__title">Categories</h2>
          <p class="record-form__version">The fixed checklist category list and its default items.</p>
        </div>
        <Button label="Add category" icon="pi pi-plus" @click="openCategoryCreate" />
      </div>

      <DataTable :value="store.sortedCategories" :loading="store.isLoading" data-key="id" striped-rows @row-click="selectCategory">
        <Column field="name" header="Name" sortable />
        <Column field="sortOrder" header="Order" sortable />
        <Column header="Item count">
          <template #body="{ data }">{{ data.items.length }}</template>
        </Column>
        <Column header="Actions">
          <template #body="{ data }">
            <div class="settings-execution__actions">
              <Button label="Edit" icon="pi pi-pencil" severity="secondary" @click.stop="openCategoryEdit(data)" />
              <Button label="Remove" icon="pi pi-trash" severity="danger" outlined :loading="isSaving" @click.stop="removeCategory(data)" />
            </div>
          </template>
        </Column>
      </DataTable>

      <section class="settings-execution__subsection" aria-labelledby="checklist-items-title">
        <div class="settings-execution__panel-header">
          <div>
            <h3 id="checklist-items-title" class="settings-execution__subheading">{{ selectedCategory?.name ?? 'Items' }}</h3>
            <p class="record-form__version">Items appear on the technician checklist in this order.</p>
          </div>
          <Button label="Add item" icon="pi pi-plus" :disabled="!selectedCategory" @click="openItemCreate" />
        </div>

        <DataTable :value="selectedCategory?.items ?? []" data-key="id" striped-rows>
          <Column field="label" header="Item" sortable />
          <Column field="sortOrder" header="Order" sortable />
          <Column header="Actions">
            <template #body="{ data }">
              <div class="settings-execution__actions">
                <Button label="Edit" icon="pi pi-pencil" severity="secondary" @click="openItemEdit(data)" />
                <Button label="Remove" icon="pi pi-trash" severity="danger" outlined :loading="isSaving" @click="removeItem(data)" />
              </div>
            </template>
          </Column>
        </DataTable>
      </section>
    </section>

    <section class="settings-execution__panel" aria-labelledby="checklist-templates-title">
      <div class="settings-execution__panel-header">
        <div>
          <h2 id="checklist-templates-title" class="crm-section__title">Checklist Templates</h2>
          <p class="record-form__version">Reusable named checklists for scheduled job orders.</p>
        </div>
        <Button label="Add template" icon="pi pi-plus" @click="openTemplateCreate" />
      </div>

      <DataTable :value="store.sortedTemplates" :loading="store.isLoadingTemplates" data-key="id" striped-rows>
        <Column field="name" header="Name" sortable />
        <Column header="Category" sortable>
          <template #body="{ data }">{{ categoryLabel(data.categoryId) }}</template>
        </Column>
        <Column header="Item count">
          <template #body="{ data }">{{ data.entries.length }}</template>
        </Column>
        <Column header="Actions">
          <template #body="{ data }">
            <div class="settings-execution__actions">
              <Button label="Edit" icon="pi pi-pencil" severity="secondary" @click="openTemplateEdit(data)" />
              <Button label="Remove" icon="pi pi-trash" severity="danger" outlined :loading="isSaving" @click="removeTemplate(data)" />
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <section class="settings-execution__panel" aria-labelledby="other-settings-title">
      <h2 id="other-settings-title" class="crm-section__title">Other settings</h2>
      <div class="settings-execution__empty">
        <i class="ti ti-settings" aria-hidden="true"></i>
        <p>Additional job execution settings are coming soon.</p>
      </div>
    </section>

    <Dialog v-model:visible="showCategoryDialog" modal :header="categoryDialogTitle" class="settings-execution__dialog">
      <form class="record-form" @submit.prevent="saveCategory">
        <label class="auth-field" for="checklist-category-name">
          <span>Name</span>
          <InputText id="checklist-category-name" v-model="categoryForm.name" class="auth-input" required />
        </label>
        <label class="auth-field" for="checklist-category-order">
          <span>Sort order</span>
          <InputNumber v-model="categoryForm.sortOrder" input-id="checklist-category-order" class="auth-input" />
        </label>
        <div class="record-form__actions">
          <Button type="button" label="Cancel" severity="secondary" @click="showCategoryDialog = false" />
          <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="showItemDialog" modal :header="itemDialogTitle" class="settings-execution__dialog">
      <form class="record-form" @submit.prevent="saveItem">
        <label class="auth-field" for="checklist-item-label">
          <span>Label</span>
          <InputText id="checklist-item-label" v-model="itemForm.label" class="auth-input" required />
        </label>
        <label class="auth-field" for="checklist-item-order">
          <span>Sort order</span>
          <InputNumber v-model="itemForm.sortOrder" input-id="checklist-item-order" class="auth-input" />
        </label>
        <div class="record-form__actions">
          <Button type="button" label="Cancel" severity="secondary" @click="showItemDialog = false" />
          <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="showTemplateDialog" modal :header="templateDialogTitle" class="settings-execution__dialog settings-execution__dialog--wide">
      <form class="record-form" @submit.prevent="saveTemplate">
        <label class="auth-field" for="checklist-template-name">
          <span>Name</span>
          <InputText id="checklist-template-name" v-model="templateForm.name" class="auth-input" required />
        </label>
        <label class="auth-field" for="checklist-template-category">
          <span>Category</span>
          <select id="checklist-template-category" v-model="templateForm.categoryId" class="auth-input">
            <option value="">Independent (any job)</option>
            <option v-for="category in store.sortedCategories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
        </label>

        <div class="settings-execution__entry-list">
          <div class="settings-execution__entry-list-header">
            <span>Items</span>
          </div>
          <div class="settings-execution__entry-add">
            <InputText
              v-model="templateEntryDraft"
              class="auth-input"
              placeholder="Checklist item label"
              aria-label="Checklist item label"
              @keydown.enter.prevent="addTemplateEntry"
            />
            <Button type="button" label="Add item" icon="pi pi-plus" severity="secondary" outlined @click="addTemplateEntry" />
          </div>
          <ul class="settings-execution__template-items" aria-label="Template items">
            <li v-for="(entry, index) in templateForm.entries" :key="entry.id ?? `${entry.label}-${index}`" class="settings-execution__template-item">
              <span>{{ entry.label }}</span>
              <div class="settings-execution__entry-actions">
                <Button type="button" icon="pi pi-arrow-up" severity="secondary" text :disabled="index === 0" aria-label="Move item up" @click="moveTemplateEntry(index, -1)" />
                <Button type="button" icon="pi pi-arrow-down" severity="secondary" text :disabled="index === templateForm.entries.length - 1" aria-label="Move item down" @click="moveTemplateEntry(index, 1)" />
                <Button type="button" icon="pi pi-times" severity="danger" text aria-label="Remove item" @click="removeTemplateEntry(index)" />
              </div>
            </li>
          </ul>
        </div>

        <div class="record-form__actions">
          <Button type="button" label="Cancel" severity="secondary" @click="showTemplateDialog = false" />
          <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
        </div>
      </form>
    </Dialog>
  </main>
</template>

<style scoped>
.settings-execution__panel {
  display: grid;
  gap: var(--sp-4);
  padding: 20px;
  background: #fff;
  border: 0.5px solid #D3DCE3;
  border-radius: 12px;
}

.settings-execution__panel + .settings-execution__panel {
  margin-top: var(--sp-4);
}

.settings-execution__panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.settings-execution__subsection {
  display: grid;
  gap: var(--sp-3);
  padding-top: var(--sp-4);
  border-top: 0.5px solid #D3DCE3;
}

.settings-execution__subheading {
  margin: 0;
  color: #11202E;
  font-size: 16px;
  font-weight: 600;
}

.settings-execution__actions,
.settings-execution__entry-actions,
.settings-execution__entry-list-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}

.settings-execution__dialog {
  width: min(100%, 34rem);
}

.settings-execution__dialog--wide {
  width: min(100%, 44rem);
}

.settings-execution__entry-list {
  display: grid;
  gap: var(--sp-3);
}

.settings-execution__entry-list-header {
  justify-content: space-between;
  color: #34495C;
  font-size: 13px;
  font-weight: 600;
}

.settings-execution__entry-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--sp-2);
}

.settings-execution__template-items {
  display: grid;
  gap: var(--sp-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.settings-execution__template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 8px 10px;
  border: 0.5px solid #D3DCE3;
  border-radius: 8px;
  color: #34495C;
  font-size: 13px;
}

.settings-execution__empty {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 18px;
  background: #F4F7FA;
  border: 0.5px dashed #C2CCD4;
  border-radius: 12px;
  color: #8B98A3;
  font-style: italic;
}

.settings-execution__empty i {
  color: #5C7081;
  font-size: 18px;
}

@media (max-width: 768px) {
  .settings-execution__panel-header,
  .settings-execution__entry-add,
  .settings-execution__template-item {
    display: grid;
  }
}
</style>
