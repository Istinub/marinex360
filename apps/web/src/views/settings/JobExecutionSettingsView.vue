<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { ChecklistCategory, ChecklistTemplateItem } from '@/lib/api/types';
import { useChecklistCategoriesStore } from '@/stores/checklistCategories';

const store = useChecklistCategoriesStore();
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const isSaving = ref(false);
const selectedCategoryId = ref<string | null>(null);
const showCategoryDialog = ref(false);
const showItemDialog = ref(false);
const categoryForm = reactive({ id: null as string | null, name: '', sortOrder: 0 });
const itemForm = reactive({ id: null as string | null, label: '', sortOrder: 0 });

const selectedCategory = computed(() =>
  store.sortedCategories.find((category) => category.id === selectedCategoryId.value) ?? store.sortedCategories[0] ?? null);
const categoryDialogTitle = computed(() => categoryForm.id ? 'Edit category' : 'Add category');
const itemDialogTitle = computed(() => itemForm.id ? 'Edit item' : 'Add item');

async function load(): Promise<void> {
  errorMessage.value = null;
  try {
    await store.load(true);
    selectedCategoryId.value ??= store.sortedCategories[0]?.id ?? null;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load checklist categories.';
  }
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
    successMessage.value = 'Item removed.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to remove item.';
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
        <p class="record-form__version">Manage checklist categories and mobile tick-list items.</p>
      </div>
      <Button label="Add category" icon="pi pi-plus" @click="openCategoryCreate" />
    </header>

    <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
    <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>

    <section class="settings-execution">
      <DataTable
        :value="store.sortedCategories"
        :loading="store.isLoading"
        data-key="id"
        striped-rows
        @row-click="selectCategory"
      >
        <Column field="name" header="Category" sortable />
        <Column field="sortOrder" header="Order" sortable />
        <Column header="Items">
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

      <section class="crm-section" aria-labelledby="checklist-items-title">
        <div class="crm-page__header">
          <div>
            <h2 id="checklist-items-title" class="crm-section__title">{{ selectedCategory?.name ?? 'Items' }}</h2>
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
  </main>
</template>

<style scoped>
.settings-execution {
  display: grid;
  gap: var(--sp-4);
}

.settings-execution__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.settings-execution__dialog {
  width: min(100%, 34rem);
}
</style>
