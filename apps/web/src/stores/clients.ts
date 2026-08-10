import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { get, patch, post } from '@/lib/api/client';
import type { Client, ClientDetail } from '@/lib/api/types';

export interface ClientInput {
  name: string;
  address?: string | null;
  creditTerms?: string | null;
  status?: string;
  primaryContactId?: string | null;
}

export interface ClientPatchInput extends ClientInput {
  version: number;
}

export const useClientsStore = defineStore('clients', () => {
  const clients = ref<Client[]>([]);
  const selectedClient = ref<ClientDetail | null>(null);
  const isLoading = ref(false);

  const sortedClients = computed(() => [...clients.value].sort((a, b) => a.name.localeCompare(b.name)));

  async function loadClients(): Promise<Client[]> {
    isLoading.value = true;
    try {
      clients.value = await get<Client[]>('/clients');
      return clients.value;
    } finally {
      isLoading.value = false;
    }
  }

  async function loadClient(id: string): Promise<ClientDetail> {
    selectedClient.value = await get<ClientDetail>(`/clients/${id}`);
    return selectedClient.value;
  }

  async function createClient(input: ClientInput): Promise<Client> {
    const created = await post<Client, ClientInput>('/clients', input);
    clients.value = [created, ...clients.value.filter((client) => client.id !== created.id)];
    return created;
  }

  async function updateClient(id: string, input: ClientPatchInput): Promise<Client> {
    const updated = await patch<Client, ClientPatchInput>(`/clients/${id}`, input);
    clients.value = clients.value.map((client) => (client.id === updated.id ? updated : client));
    if (selectedClient.value?.id === updated.id) {
      selectedClient.value = { ...selectedClient.value, ...updated };
    }
    return updated;
  }

  return {
    clients,
    selectedClient,
    isLoading,
    sortedClients,
    loadClients,
    loadClient,
    createClient,
    updateClient,
  };
});
