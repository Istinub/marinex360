import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { get } from '@/lib/api/client';
import type { Vessel } from '@/lib/api/types';

export const useVesselsStore = defineStore('vessels', () => {
  const vessels = ref<Vessel[]>([]);
  const isLoading = ref(false);

  const sortedVessels = computed(() => [...vessels.value].sort((a, b) => a.name.localeCompare(b.name)));

  async function list(clientId?: string): Promise<Vessel[]> {
    isLoading.value = true;
    try {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      vessels.value = await get<Vessel[]>(`/vessels${query}`);
      return vessels.value;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    vessels,
    isLoading,
    sortedVessels,
    list,
  };
});
