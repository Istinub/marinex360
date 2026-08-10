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
  serviceCategories?: string[];
  plannedStartDate?: string | null;
  externalQuoteRef?: string | null;
  externalRfqRef?: string | null;
}

export interface JobOrderTransitionInput {
  to: JobState;
  reason?: string;
  version: number;
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

  async function transitionJobOrder(id: string, input: JobOrderTransitionInput): Promise<JobOrder> {
    const updated = await post<JobOrder, JobOrderTransitionInput>(`/job-orders/${id}/transition`, input);
    jobOrders.value = jobOrders.value.map((jobOrder) => (jobOrder.id === updated.id ? updated : jobOrder));
    if (selectedJobOrder.value?.id === updated.id) selectedJobOrder.value = updated;
    return updated;
  }

  return {
    jobOrders,
    selectedJobOrder,
    isLoading,
    sortedJobOrders,
    loadJobOrders,
    loadJobOrder,
    createJobOrder,
    updateJobOrder,
    transitionJobOrder,
  };
});
