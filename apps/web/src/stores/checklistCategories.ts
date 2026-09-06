import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { del, get, patch, post } from '@/lib/api/client';
import type { ChecklistCategory } from '@/lib/api/types';

export interface ChecklistCategoryInput {
  name: string;
  sortOrder?: number;
}

export interface ChecklistItemInput {
  label: string;
  sortOrder?: number;
}

export const useChecklistCategoriesStore = defineStore('checklistCategories', () => {
  const categories = ref<ChecklistCategory[]>([]);
  const isLoading = ref(false);
  const loaded = ref(false);

  const sortedCategories = computed(() => [...categories.value].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
  const options = computed(() => sortedCategories.value.map((category) => ({ label: category.name, value: category.id })));

  async function load(force = false): Promise<ChecklistCategory[]> {
    if (loaded.value && !force) return categories.value;
    isLoading.value = true;
    try {
      categories.value = await get<ChecklistCategory[]>('/checklist-categories');
      loaded.value = true;
      return categories.value;
    } finally {
      isLoading.value = false;
    }
  }

  async function createCategory(input: ChecklistCategoryInput): Promise<ChecklistCategory> {
    const created = await post<ChecklistCategory, ChecklistCategoryInput>('/checklist-categories', input);
    await load(true);
    return created;
  }

  async function updateCategory(id: string, input: Partial<ChecklistCategoryInput>): Promise<ChecklistCategory> {
    const updated = await patch<ChecklistCategory, Partial<ChecklistCategoryInput>>(`/checklist-categories/${id}`, input);
    categories.value = categories.value.map((category) => category.id === updated.id ? updated : category);
    return updated;
  }

  async function deleteCategory(id: string): Promise<void> {
    await del<{ deleted: boolean }>(`/checklist-categories/${id}`);
    categories.value = categories.value.filter((category) => category.id !== id);
  }

  async function createItem(categoryId: string, input: ChecklistItemInput): Promise<ChecklistCategory> {
    const updated = await post<ChecklistCategory, ChecklistItemInput>(`/checklist-categories/${categoryId}/items`, input);
    categories.value = categories.value.map((category) => category.id === updated.id ? updated : category);
    return updated;
  }

  async function updateItem(categoryId: string, itemId: string, input: Partial<ChecklistItemInput>): Promise<ChecklistCategory> {
    const updated = await patch<ChecklistCategory, Partial<ChecklistItemInput>>(`/checklist-categories/${categoryId}/items/${itemId}`, input);
    categories.value = categories.value.map((category) => category.id === updated.id ? updated : category);
    return updated;
  }

  async function deleteItem(categoryId: string, itemId: string): Promise<ChecklistCategory> {
    const updated = await del<ChecklistCategory>(`/checklist-categories/${categoryId}/items/${itemId}`);
    categories.value = categories.value.map((category) => category.id === updated.id ? updated : category);
    return updated;
  }

  return {
    categories,
    isLoading,
    loaded,
    sortedCategories,
    options,
    load,
    createCategory,
    updateCategory,
    deleteCategory,
    createItem,
    updateItem,
    deleteItem,
  };
});
