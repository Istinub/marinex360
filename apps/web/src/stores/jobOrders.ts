import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { get, patch, post } from '@/lib/api/client';
import type { JobOrder, JobState } from '@/lib/api/types';

export interface JobOrderCreateInput {
  clientId: string;
  vesselId: string;
  serviceCategories?: string[];
  port?: string | null;
  scopeSummary: string;
  externalQuoteRef?: string | null;
  externalRfqRef?: string | null;
  quotedAmountMinor: number;
  quotedCurrency: string;
  labourRateAmountMinor?: number | null;
  labourRateCurrency?: string | null;
  plannedStartDate?: string | null;
}

export interface JobOrderPatchInput {
  version: number;
  scopeSummary?: string;
  port?: string | null;
  plannedStartDate?: string | null;
  externalQuoteRef?: string | null;
  externalRfqRef?: string | null;
}

export interface JobOrderCategoriesInput {
  serviceCategories: string[];
  version: number;
}

export interface JobOrderTransitionInput {
  to: JobState;
  reason?: string;
  version: number;
}

export interface JobOrderAssignInput {
  technicianIds: string[];
  executionOwnerId: string;
  version: number;
}

export interface TechnicianLookup {
  id: string;
  name: string;
}

export const useJobOrdersStore = defineStore('jobOrders', () => {
  const jobOrders = ref<JobOrder[]>([]);
  const selectedJobOrder = ref<JobOrder | null>(null);
  const isLoading = ref(false);

  const sortedJobOrders = computed(() => [...jobOrders.value]);

  async function loadJobOrders(): Promise<JobOrder[]> {
    isLoading.value = true;
    try {
      jobOrders.value = await get<JobOrder[]>('/job-orders');
      return jobOrders.value;
    } finally {
      isLoading.value = false;
    }
  }

  async function loadTrashedJobOrders(): Promise<JobOrder[]> {
    return get<JobOrder[]>('/job-orders/trash');
  }

  async function loadArchivedJobOrders(): Promise<JobOrder[]> {
    return get<JobOrder[]>('/job-orders/archive');
  }

  async function loadJobOrder(id: string): Promise<JobOrder> {
    selectedJobOrder.value = await get<JobOrder>(`/job-orders/${id}`);
    return selectedJobOrder.value;
  }

  async function createJobOrder(input: JobOrderCreateInput): Promise<JobOrder> {
    const created = await post<JobOrder, JobOrderCreateInput>('/job-orders', input);
    jobOrders.value = [created, ...jobOrders.value.filter((jobOrder) => jobOrder.id !== created.id)];
    return created;
  }

  async function updateJobOrder(id: string, input: JobOrderPatchInput): Promise<JobOrder> {
    const updated = await patch<JobOrder, JobOrderPatchInput>(`/job-orders/${id}`, input);
    jobOrders.value = jobOrders.value.map((jobOrder) => (jobOrder.id === updated.id ? updated : jobOrder));
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  async function updateJobOrderCategories(id: string, input: JobOrderCategoriesInput): Promise<JobOrder> {
    const updated = await patch<JobOrder, JobOrderCategoriesInput>(`/job-orders/${id}/categories`, input);
    jobOrders.value = jobOrders.value.map((jobOrder) => (jobOrder.id === updated.id ? updated : jobOrder));
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  async function transitionJobOrder(id: string, input: JobOrderTransitionInput): Promise<JobOrder> {
    const updated = await post<JobOrder, JobOrderTransitionInput>(`/job-orders/${id}/transition`, input);
    jobOrders.value = jobOrders.value.map((jobOrder) => (jobOrder.id === updated.id ? updated : jobOrder));
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  async function assignJobOrder(id: string, input: JobOrderAssignInput): Promise<JobOrder> {
    const updated = await post<JobOrder, JobOrderAssignInput>(`/job-orders/${id}/assign`, input);
    jobOrders.value = jobOrders.value.map((jobOrder) => (jobOrder.id === updated.id ? updated : jobOrder));
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  async function deleteJobOrder(id: string): Promise<JobOrder> {
    const updated = await post<JobOrder, Record<string, never>>(`/job-orders/${id}/delete`, {});
    jobOrders.value = jobOrders.value.filter((jobOrder) => jobOrder.id !== updated.id);
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  async function archiveJobOrder(id: string): Promise<JobOrder> {
    const updated = await post<JobOrder, Record<string, never>>(`/job-orders/${id}/archive`, {});
    jobOrders.value = jobOrders.value.filter((jobOrder) => jobOrder.id !== updated.id);
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  async function purgeJobOrder(id: string): Promise<void> {
    await post<{ purged: boolean }, Record<string, never>>(`/job-orders/${id}/purge`, {});
    jobOrders.value = jobOrders.value.filter((jobOrder) => jobOrder.id !== id);
    if (selectedJobOrder.value?.id === id) selectedJobOrder.value = null;
  }

  async function emptyTrash(): Promise<{ purged: number }> {
    return post<{ purged: number }, Record<string, never>>('/job-orders/trash/empty', {});
  }

  function loadTechnicians(): Promise<TechnicianLookup[]> {
    return get<TechnicianLookup[]>('/technicians');
  }

  return {
    jobOrders,
    selectedJobOrder,
    isLoading,
    sortedJobOrders,
    loadJobOrders,
    loadTrashedJobOrders,
    loadArchivedJobOrders,
    loadJobOrder,
    createJobOrder,
    updateJobOrder,
    updateJobOrderCategories,
    transitionJobOrder,
    assignJobOrder,
    deleteJobOrder,
    archiveJobOrder,
    purgeJobOrder,
    emptyTrash,
    loadTechnicians,
  };
});
