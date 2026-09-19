<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FieldError from '@/components/common/FieldError.vue';
import MonoText from '@/components/common/MonoText.vue';
import NotFoundState from '@/components/common/NotFoundState.vue';
import VersionConflictDialog from '@/components/common/VersionConflictDialog.vue';
import { ApiResponseError } from '@/lib/api/errors';
import type { VendorDetail } from '@/lib/api/types';
import { useAuthStore } from '@/stores/auth';
import { useVendorsStore, type VendorInput } from '@/stores/vendors';

type VendorField = 'name' | 'branch' | 'email' | 'phone' | 'address';

const branchOptions = ['SG', 'MY', 'ID', 'BD'];
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const vendorsStore = useVendorsStore();

const isEdit = computed(() => route.name === 'vendor-edit');
const vendorId = computed(() => String(route.params.id ?? ''));
const canChooseBranch = computed(() => {
  const roles = auth.identity?.roles ?? [];
  return roles.includes('SYSTEM_ADMIN') || roles.includes('DIRECTOR');
});
const loadedVendor = ref<VendorDetail | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const isNotFound = ref(false);
const showConflict = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = reactive<Partial<Record<VendorField, string>>>({});
const form = reactive<Record<VendorField, string>>({
  name: '',
  branch: auth.identity?.branch ?? 'SG',
  email: '',
  phone: '',
  address: '',
});

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors) as VendorField[]) delete fieldErrors[key];
}

function applyLoadedVendor(vendor: VendorDetail): void {
  loadedVendor.value = vendor;
  form.name = vendor.name;
  form.branch = vendor.branch;
  form.email = vendor.email ?? '';
  form.phone = vendor.phone ?? '';
  form.address = vendor.address ?? '';
}

function payload(): VendorInput {
  return {
    name: form.name.trim(),
    branch: form.branch,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
  };
}

function applyValidation(error: ApiResponseError): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false;
  if (error.message.includes('name')) fieldErrors.name = error.message;
  else if (error.message.includes('branch')) fieldErrors.branch = error.message;
  else formError.value = error.message;
  return true;
}

async function loadForEdit(): Promise<void> {
  if (!isEdit.value) return;

  isLoading.value = true;
  try {
    applyLoadedVendor(await vendorsStore.loadVendor(vendorId.value));
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'NOT_FOUND') {
      isNotFound.value = true;
      return;
    }
    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to load vendor.';
  } finally {
    isLoading.value = false;
  }
}

async function reloadVersionForConflict(): Promise<void> {
  const fresh = await vendorsStore.loadVendor(vendorId.value);
  applyLoadedVendor(fresh);
  showConflict.value = true;
}

async function saveVendor(isConflictConfirm = false): Promise<void> {
  clearFieldErrors();
  formError.value = null;
  isSaving.value = true;

  try {
    if (isEdit.value) {
      if (!loadedVendor.value) throw new Error('Vendor is not loaded.');
      const updated = await vendorsStore.updateVendor(vendorId.value, {
        ...payload(),
        version: loadedVendor.value.version,
      });
      showConflict.value = false;
      await router.replace(`/vendors/${updated.id}`);
      return;
    }

    const created = await vendorsStore.createVendor(payload());
    await router.replace(`/vendors/${created.id}`);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      if (error.code === 'VERSION_CONFLICT' && isEdit.value && !isConflictConfirm) {
        await reloadVersionForConflict();
        return;
      }
      if (applyValidation(error)) return;
      formError.value = error.message;
      return;
    }
    formError.value = 'Unable to save vendor.';
  } finally {
    isSaving.value = false;
  }
}

onMounted(loadForEdit);
</script>

<template>
  <NotFoundState v-if="isNotFound" />

  <main v-else class="office-route crm-page" aria-labelledby="vendor-form-title">
    <div class="record-form-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Vendor</p>
          <h1 id="vendor-form-title" class="crm-page__title">
            {{ isEdit ? 'Edit vendor' : 'New vendor' }}
          </h1>
        </div>
      </header>

      <p v-if="isLoading" class="crm-empty">Loading vendor...</p>

      <form v-else class="record-form record-form--structured" @submit.prevent="saveVendor(false)">
        <p v-if="formError" class="auth-message auth-message--error" role="alert">
          {{ formError }}
        </p>

        <section class="record-form__section" aria-labelledby="vendor-details-heading">
          <h2 id="vendor-details-heading" class="record-form__section-heading">Details</h2>

          <label class="auth-field" for="vendor-name">
            <span>Name</span>
            <input id="vendor-name" v-model="form.name" class="auth-input" placeholder="Vendor name" required />
            <FieldError :message="fieldErrors.name" />
          </label>

          <label class="auth-field" for="vendor-branch">
            <span>Branch</span>
            <select v-if="canChooseBranch" id="vendor-branch" v-model="form.branch" class="auth-input">
              <option v-for="branch in branchOptions" :key="branch" :value="branch">{{ branch }}</option>
            </select>
            <input v-else id="vendor-branch" :value="form.branch" class="auth-input" readonly />
            <FieldError :message="fieldErrors.branch" />
          </label>
        </section>

        <section class="record-form__section" aria-labelledby="vendor-contact-heading">
          <h2 id="vendor-contact-heading" class="record-form__section-heading">Contact</h2>

          <label class="auth-field" for="vendor-email">
            <span>Email</span>
            <input id="vendor-email" v-model="form.email" class="auth-input" type="email" placeholder="Email" />
            <FieldError :message="fieldErrors.email" />
          </label>

          <label class="auth-field" for="vendor-phone">
            <span>Phone</span>
            <input id="vendor-phone" v-model="form.phone" class="auth-input" placeholder="Phone" />
            <FieldError :message="fieldErrors.phone" />
          </label>
        </section>

        <section class="record-form__section" aria-labelledby="vendor-address-heading">
          <h2 id="vendor-address-heading" class="record-form__section-heading">Address</h2>

          <label class="auth-field record-form__field--full" for="vendor-address">
            <span>Address</span>
            <textarea
              id="vendor-address"
              v-model="form.address"
              class="auth-input record-form__textarea"
              placeholder="Vendor address"
            />
            <FieldError :message="fieldErrors.address" />
          </label>
        </section>

        <p v-if="loadedVendor" class="record-form__version">
          Version <MonoText :value="loadedVendor.version" />
        </p>

        <div class="record-form__actions">
          <Button label="Cancel" severity="secondary" @click="router.back()" />
          <Button type="submit" label="Save" icon="pi pi-save" :loading="isSaving" />
        </div>
      </form>
    </div>

    <VersionConflictDialog
      v-if="showConflict"
      :is-saving="isSaving"
      @cancel="showConflict = false"
      @confirm="saveVendor(true)"
    />
  </main>
</template>
