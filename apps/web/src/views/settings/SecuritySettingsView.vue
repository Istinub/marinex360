<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { get, patch } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';

interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  category: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

const flags = ref<FeatureFlag[]>([]);
const isLoading = ref(false);
const savingKey = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const flagCopy: Record<string, { label: string; description: string }> = {
  MFA_REQUIRED: {
    label: 'Require MFA for Admin/Finance accounts',
    description: 'When enabled, System Admin and Finance accounts must complete TOTP at login.',
  },
  DEV_TOOLS: {
    label: 'Enable database tools',
    description: 'Allows System Admin users to browse tables and run SELECT-only diagnostic queries.',
  },
};

const orderedFlags = computed(() => flags.value.filter((flag) => flagCopy[flag.key] != null));

async function load(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    flags.value = await get<FeatureFlag[]>('/admin/settings/flags');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to load security settings.';
  } finally {
    isLoading.value = false;
  }
}

async function setFlag(flag: FeatureFlag, enabled: boolean): Promise<void> {
  savingKey.value = flag.key;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const updated = await patch<FeatureFlag, { enabled: boolean }>(`/admin/settings/flags/${encodeURIComponent(flag.key)}`, { enabled });
    flags.value = flags.value.map((entry) => (entry.key === updated.key ? updated : entry));
    successMessage.value = `${flagCopy[flag.key]?.label ?? flag.key} saved.`;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to save security setting.';
  } finally {
    savingKey.value = null;
  }
}

onMounted(load);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="security-title">
    <div class="record-form-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Settings</p>
          <h1 id="security-title" class="crm-page__title">Security</h1>
          <p class="record-form__version">Manage operational feature flags for secure admin-only tooling.</p>
        </div>
      </header>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-message auth-message--success" role="status">{{ successMessage }}</p>
      <p v-if="isLoading" class="crm-empty">Loading security settings...</p>

      <section v-else class="settings-flag-list" aria-label="Security feature flags">
        <article v-for="flag in orderedFlags" :key="flag.key" class="settings-flag-row">
          <div>
            <h2>{{ flagCopy[flag.key].label }}</h2>
            <p>{{ flagCopy[flag.key].description }}</p>
            <small>{{ flag.description }}</small>
          </div>
          <label class="settings-toggle">
            <input
              type="checkbox"
              :checked="flag.enabled"
              :disabled="savingKey === flag.key"
              @change="setFlag(flag, ($event.target as HTMLInputElement).checked)"
            />
            <span class="settings-toggle__track" aria-hidden="true" />
            <span class="settings-toggle__label">{{ flag.enabled ? 'Enabled' : 'Disabled' }}</span>
          </label>
        </article>
      </section>

      <div class="record-form__actions record-form__actions--left">
        <Button label="Refresh" icon="pi pi-refresh" severity="secondary" :loading="isLoading" @click="load" />
      </div>
    </div>
  </main>
</template>

<style scoped>
.settings-flag-list {
  display: grid;
  gap: var(--sp-3);
}

.settings-flag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.settings-flag-row h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-body);
}

.settings-flag-row p,
.settings-flag-row small {
  margin: 0;
  color: var(--color-text-muted);
}

.settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  cursor: pointer;
}

.settings-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.settings-toggle__track {
  width: 2.5rem;
  height: 1.375rem;
  border-radius: 999px;
  background: #C2CCD4;
  position: relative;
  transition: background 160ms ease;
}

.settings-toggle__track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: #FFFFFF;
  transition: transform 160ms ease;
}

.settings-toggle input:checked + .settings-toggle__track {
  background: var(--color-brand);
}

.settings-toggle input:checked + .settings-toggle__track::after {
  transform: translateX(1.125rem);
}
</style>
