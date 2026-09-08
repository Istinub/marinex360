<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { get, patch } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';
import type { BrandingSettings } from '@/lib/api/types';

const settings = ref<BrandingSettings | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const apiBase = import.meta.env.VITE_API_BASE as string;
const availableLogoFilenames = computed(() => settings.value?.availableLogoFilenames ?? []);

function assetUrl(filename: string): string {
  return `${apiBase}/branding-settings/assets/${encodeURIComponent(filename)}`;
}

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    settings.value = await get<BrandingSettings>('/branding-settings');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load branding settings.';
  } finally {
    isLoading.value = false;
  }
}

async function selectLogo(logoFilename: string): Promise<void> {
  if (logoFilename === settings.value?.logoFilename) return;
  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const updated = await patch<Omit<BrandingSettings, 'availableLogoFilenames'>, { logoFilename: string }>('/branding-settings', { logoFilename });
    settings.value = {
      ...updated,
      availableLogoFilenames: availableLogoFilenames.value,
    };
    successMessage.value = 'Branding saved.';
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save branding settings.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="branding-title">
    <div class="record-form-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Settings</p>
          <h1 id="branding-title" class="crm-page__title">Branding</h1>
          <p class="record-form__version">Choose the logo used on generated invoices and job completion reports.</p>
        </div>
      </header>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>
      <p v-if="isLoading" class="crm-empty">Loading branding settings...</p>

      <section v-else class="branding-logo-grid" aria-label="Available logo choices">
        <button
          v-for="filename in availableLogoFilenames"
          :key="filename"
          type="button"
          class="branding-logo-card"
          :class="{ 'branding-logo-card--active': filename === settings?.logoFilename }"
          :disabled="isSaving"
          @click="selectLogo(filename)"
        >
          <span class="branding-logo-card__image">
            <img :src="assetUrl(filename)" :alt="filename" />
          </span>
          <span class="branding-logo-card__name">{{ filename }}</span>
          <span v-if="filename === settings?.logoFilename" class="jo-chip mx-jo-completed">Active</span>
        </button>
      </section>

      <div class="record-form__actions record-form__actions--left">
        <Button label="Refresh" icon="pi pi-refresh" severity="secondary" :loading="isLoading" @click="load" />
      </div>
    </div>
  </main>
</template>

<style scoped>
.branding-logo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--sp-3);
}

.branding-logo-card {
  display: grid;
  gap: var(--sp-2);
  justify-items: start;
  padding: var(--sp-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.branding-logo-card--active {
  border-color: var(--color-brand);
  box-shadow: inset 3px 0 0 var(--color-brand);
}

.branding-logo-card__image {
  width: 100%;
  min-height: 6rem;
  display: grid;
  place-items: center;
  padding: var(--sp-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #FFFFFF;
}

.branding-logo-card__image img {
  max-width: 100%;
  max-height: 5rem;
  object-fit: contain;
}

.branding-logo-card__name {
  font-family: var(--font-code);
  font-size: var(--fs-body-sm);
}
</style>
