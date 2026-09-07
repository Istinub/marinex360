import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { del, get, patch, post } from '@/lib/api/client';
import type { ChecklistCategory, ChecklistTemplate, ChecklistTemplateEntry } from '@/lib/api/types';

export interface ChecklistCategoryInput {
  name: string;
  sortOrder?: number;
}

export interface ChecklistItemInput {
  label: string;
  sortOrder?: number;
}

export interface ChecklistTemplateInput {
  name: string;
  categoryId?: string | null;
  entries?: ChecklistItemInput[];
}

export const useChecklistCategoriesStore = defineStore('checklistCategories', () => {
  const categories = ref<ChecklistCategory[]>([]);
  const templates = ref<ChecklistTemplate[]>([]);
  const isLoading = ref(false);
  const isLoadingTemplates = ref(false);
  const loaded = ref(false);
  const templatesLoaded = ref(false);

  const sortedCategories = computed(() => [...categories.value].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
  const options = computed(() => sortedCategories.value.map((category) => ({ label: category.name, value: category.id })));
  const sortedTemplates = computed(() => [...templates.value].sort((a, b) => a.name.localeCompare(b.name)));

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

  async function loadTemplates(force = false): Promise<ChecklistTemplate[]> {
    if (templatesLoaded.value && !force) return templates.value;
    isLoadingTemplates.value = true;
    try {
      templates.value = await get<ChecklistTemplate[]>('/checklist-templates');
      templatesLoaded.value = true;
      return templates.value;
    } finally {
      isLoadingTemplates.value = false;
    }
  }

  async function createTemplate(input: ChecklistTemplateInput): Promise<ChecklistTemplate> {
    const created = await post<ChecklistTemplate, ChecklistTemplateInput>('/checklist-templates', input);
    await loadTemplates(true);
    return created;
  }

  async function updateTemplate(id: string, input: ChecklistTemplateInput): Promise<ChecklistTemplate> {
    const updated = await patch<ChecklistTemplate, ChecklistTemplateInput>(`/checklist-templates/${id}`, input);
    await loadTemplates(true);
    return updated;
  }

  async function deleteTemplate(id: string): Promise<void> {
    await del<{ deleted: boolean }>(`/checklist-templates/${id}`);
    templates.value = templates.value.filter((template) => template.id !== id);
  }

  async function createTemplateEntry(templateId: string, input: ChecklistItemInput): Promise<ChecklistTemplateEntry> {
    const created = await post<ChecklistTemplateEntry, ChecklistItemInput>(`/checklist-templates/${templateId}/entries`, input);
    await loadTemplates(true);
    return created;
  }

  async function updateTemplateEntry(templateId: string, entryId: string, input: ChecklistItemInput): Promise<ChecklistTemplateEntry> {
    const updated = await patch<ChecklistTemplateEntry, ChecklistItemInput>(`/checklist-templates/${templateId}/entries/${entryId}`, input);
    await loadTemplates(true);
    return updated;
  }

  async function deleteTemplateEntry(templateId: string, entryId: string): Promise<void> {
    await del<{ deleted: boolean }>(`/checklist-templates/${templateId}/entries/${entryId}`);
    await loadTemplates(true);
  }

  return {
    categories,
    templates,
    isLoading,
    isLoadingTemplates,
    loaded,
    templatesLoaded,
    sortedCategories,
    sortedTemplates,
    options,
    load,
    createCategory,
    updateCategory,
    deleteCategory,
    createItem,
    updateItem,
    deleteItem,
    loadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    createTemplateEntry,
    updateTemplateEntry,
    deleteTemplateEntry,
  };
});
