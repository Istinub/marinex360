import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { get, patch, post } from '@/lib/api/client';
import type { Vendor, VendorDetail } from '@/lib/api/types';

export interface VendorInput {
  name: string;
  branch?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface VendorPatchInput extends VendorInput {
  version: number;
}

export const useVendorsStore = defineStore('vendors', () => {
  const vendors = ref<Vendor[]>([]);
  const isLoading = ref(false);

  const sortedVendors = computed(() => [...vendors.value].sort((a, b) => a.name.localeCompare(b.name)));

  async function loadVendors(): Promise<Vendor[]> {
    isLoading.value = true;
    try {
      vendors.value = await get<Vendor[]>('/vendors');
      return vendors.value;
    } finally {
      isLoading.value = false;
    }
  }

  async function createVendor(input: VendorInput): Promise<Vendor> {
    const created = await post<Vendor, VendorInput>('/vendors', input);
    vendors.value = [created, ...vendors.value.filter((vendor) => vendor.id !== created.id)];
    return created;
  }

  async function loadVendor(id: string): Promise<VendorDetail> {
    const vendor = await get<VendorDetail>(`/vendors/${id}`);
    vendors.value = [vendor, ...vendors.value.filter((item) => item.id !== vendor.id)];
    return vendor;
  }

  async function updateVendor(id: string, input: VendorPatchInput): Promise<Vendor> {
    const updated = await patch<Vendor, VendorPatchInput>(`/vendors/${id}`, input);
    vendors.value = vendors.value.map((vendor) => (vendor.id === updated.id ? updated : vendor));
    return updated;
  }

  return { vendors, isLoading, sortedVendors, loadVendors, loadVendor, createVendor, updateVendor };
});
