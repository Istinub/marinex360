<script setup lang="ts">
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import {
  deleteUnsyncedLocalEntry,
  listLocalMaterials,
  updateLocalMaterial,
  type LocalMaterialEntry,
} from '@/composables/useLocalExecutionEntries';
import {
  moneyTextToMinorUnits,
  normalizeCurrency,
  normalizeQuantity,
  useMaterialLines,
  type MaterialLineCreateInput,
} from '@/composables/useMaterialLines';

type FieldErrorKey =
  | 'description'
  | 'quantity'
  | 'unit'
  | 'unitCostAmountMinor'
  | 'unitCostCurrency'
  | 'jobOrderId';

const props = defineProps<{
  jobOrderId?: string;
}>();

const route = useRoute();
const materialLines = useMaterialLines();
const { isSubmitting } = materialLines;
const errors = reactive<Partial<Record<FieldErrorKey, string>>>({});
const successMessage = ref<string | null>(null);
const materials = ref<LocalMaterialEntry[]>([]);
const editingEntry = ref<LocalMaterialEntry | null>(null);

const form = reactive({
  description: '',
  quantity: '',
  unit: '',
  unitCostText: '',
  unitCostCurrency: 'SGD',
});

const currencyOptions = ['SGD', 'USD', 'EUR'];

const resolvedJobOrderId = computed(() => {
  const routeId = route.params.id ?? route.params.jobOrderId;
  if (props.jobOrderId) return props.jobOrderId;
  return Array.isArray(routeId) ? routeId[0] : routeId;
});

function clearErrors(): void {
  for (const key of Object.keys(errors) as FieldErrorKey[]) delete errors[key];
}

function resetForm(): void {
  form.description = '';
  form.quantity = '';
  form.unit = '';
  form.unitCostText = '';
  form.unitCostCurrency = 'SGD';
  editingEntry.value = null;
}

function validatedInput(): MaterialLineCreateInput | null {
  clearErrors();
  successMessage.value = null;

  const jobOrderId = resolvedJobOrderId.value?.trim();
  const description = form.description.trim();
  const quantity = normalizeQuantity(form.quantity);
  const unit = form.unit.trim();
  const unitCostAmountMinor = moneyTextToMinorUnits(form.unitCostText);
  const unitCostCurrency = normalizeCurrency(form.unitCostCurrency);

  if (!jobOrderId) errors.jobOrderId = 'Job order is required.';
  if (!description) errors.description = 'Description is required.';
  if (!quantity) errors.quantity = 'Enter a quantity with up to 3 decimal places.';
  if (!unit) errors.unit = 'Unit is required.';
  if (unitCostAmountMinor == null) errors.unitCostAmountMinor = 'Enter a money amount with cents.';
  if (!unitCostCurrency) errors.unitCostCurrency = 'Currency must be a 3-letter code.';

  if (Object.keys(errors).length > 0 || !jobOrderId || !quantity || unitCostAmountMinor == null || !unitCostCurrency) {
    return null;
  }

  return {
    jobOrderId,
    partCatalogId: null,
    description,
    quantity,
    unit,
    unitCostAmountMinor,
    unitCostCurrency,
  };
}

async function submitLine(addAnother = false): Promise<void> {
  const input = validatedInput();
  if (!input) return;

  try {
    if (editingEntry.value) {
      await updateLocalMaterial(editingEntry.value, input.jobOrderId, {
        description: input.description,
        quantity: input.quantity,
        unit: input.unit,
        unitCostAmountMinor: input.unitCostAmountMinor,
        unitCostCurrency: input.unitCostCurrency,
      });
      successMessage.value = `${input.description} updated.`;
    } else {
      const queued = await materialLines.enqueueCreate(input);
      successMessage.value = `${queued.description} queued.`;
    }
    await refreshEntries();
    resetForm();

    if (addAnother) {
      return;
    }
  } catch (error) {
    errors.jobOrderId = error instanceof Error ? error.message : 'Unable to queue material line.';
  }
}

async function refreshEntries(): Promise<void> {
  const jobOrderId = resolvedJobOrderId.value;
  materials.value = jobOrderId ? await listLocalMaterials(jobOrderId) : [];
}

function editMaterial(entry: LocalMaterialEntry): void {
  editingEntry.value = entry;
  form.description = entry.description;
  form.quantity = entry.quantity;
  form.unit = entry.unit;
  form.unitCostText = (entry.unitCostAmountMinor / 100).toFixed(2);
  form.unitCostCurrency = entry.unitCostCurrency;
  successMessage.value = null;
}

async function deleteMaterial(entry: LocalMaterialEntry): Promise<void> {
  try {
    await deleteUnsyncedLocalEntry('MaterialLine', entry.id);
    if (editingEntry.value?.id === entry.id) resetForm();
    successMessage.value = `${entry.description} deleted.`;
    await refreshEntries();
  } catch (error) {
    errors.jobOrderId = error instanceof Error ? error.message : 'Unable to delete material line.';
  }
}

onMounted(() => {
  void refreshEntries().catch((error) => {
    errors.jobOrderId = error instanceof Error ? error.message : 'Unable to load material lines.';
  });
});

// NEEDS: BE: no part-catalog lookup endpoint exists in-repo, so this form intentionally records free-text description only.
</script>

<template>
  <main class="material-line-form" aria-labelledby="material-line-title">
    <header class="material-line-form__header">
      <div>
        <MobileBackLink :to="`/jobs/${resolvedJobOrderId}`" label="Return" />
        <p class="material-line-form__eyebrow">Materials</p>
        <h1 id="material-line-title" class="material-line-form__title">Add material used</h1>
      </div>
    </header>

    <Message v-if="successMessage" severity="success" :closable="false">
      {{ successMessage }}
    </Message>

    <Message v-if="errors.jobOrderId" severity="error" :closable="false">
      {{ errors.jobOrderId }}
    </Message>

    <form class="material-line-form__body" @submit.prevent="submitLine(false)">
      <label class="material-line-form__field" for="material-description">
        <span>Description</span>
        <Textarea
          id="material-description"
          v-model="form.description"
          class="material-line-form__input"
          rows="3"
          auto-resize
          required
        />
        <small v-if="errors.description" class="material-line-form__error">{{ errors.description }}</small>
      </label>

      <div class="material-line-form__split">
        <label class="material-line-form__field" for="material-quantity">
          <span>Quantity</span>
          <InputText
            id="material-quantity"
            v-model="form.quantity"
            class="material-line-form__input material-line-form__input--mono"
            inputmode="decimal"
            autocomplete="off"
            required
          />
          <small v-if="errors.quantity" class="material-line-form__error">{{ errors.quantity }}</small>
        </label>

        <label class="material-line-form__field" for="material-unit">
          <span>Unit</span>
          <InputText
            id="material-unit"
            v-model="form.unit"
            class="material-line-form__input"
            autocomplete="off"
            required
          />
          <small v-if="errors.unit" class="material-line-form__error">{{ errors.unit }}</small>
        </label>
      </div>

      <fieldset class="material-line-form__money">
        <legend>Unit cost</legend>
        <div class="material-line-form__money-row">
          <Select
            v-model="form.unitCostCurrency"
            class="material-line-form__currency"
            :options="currencyOptions"
            aria-label="Unit cost currency"
          />
          <InputText
            v-model="form.unitCostText"
            class="material-line-form__input material-line-form__input--mono"
            inputmode="decimal"
            autocomplete="off"
            aria-label="Unit cost amount"
            required
          />
        </div>
        <small v-if="errors.unitCostCurrency" class="material-line-form__error">{{ errors.unitCostCurrency }}</small>
        <small v-if="errors.unitCostAmountMinor" class="material-line-form__error">{{ errors.unitCostAmountMinor }}</small>
      </fieldset>

      <div class="material-line-form__actions">
        <Button
          type="button"
          label="Save and add another"
          severity="secondary"
          :loading="isSubmitting"
          @click="submitLine(true)"
        />
        <Button type="submit" :label="editingEntry ? 'Update' : 'Save line'" :loading="isSubmitting" />
      </div>
    </form>

    <section class="material-line-form__saved" aria-labelledby="saved-materials-title">
      <h2 id="saved-materials-title">Saved this session</h2>
      <p v-if="materials.length === 0" class="material-line-form__empty">No materials saved yet.</p>
      <article v-for="entry in materials" :key="entry.id" class="material-line-form__entry">
        <div>
          <strong>{{ entry.description }}</strong>
          <span>{{ entry.quantity }} {{ entry.unit }} · {{ entry.syncState }}</span>
        </div>
        <div class="material-line-form__entry-actions">
          <Button type="button" label="Edit" severity="secondary" outlined @click="editMaterial(entry)" />
          <Button type="button" label="Delete" severity="secondary" outlined @click="deleteMaterial(entry)" />
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.material-line-form {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.material-line-form__header {
  margin-bottom: var(--sp-4);
}

.material-line-form__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.material-line-form__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.material-line-form__body {
  display: grid;
  gap: var(--sp-4);
  margin-top: var(--sp-4);
}

.material-line-form__field,
.material-line-form__money,
.material-line-form__saved,
.material-line-form__entry,
.material-line-form__entry-actions {
  display: grid;
  gap: var(--sp-2);
}

.material-line-form__field span,
.material-line-form__money legend {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.material-line-form__money {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.material-line-form__split,
.material-line-form__money-row,
.material-line-form__actions {
  display: grid;
  gap: var(--tap-gap);
}

.material-line-form__money-row {
  grid-template-columns: minmax(var(--sp-16), auto) minmax(0, 1fr);
}

.material-line-form__input,
.material-line-form__currency {
  width: 100%;
  min-height: var(--tap-field);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}

.material-line-form__input--mono {
  font-family: var(--font-code);
}

.material-line-form__error {
  color: var(--status-error-fg);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
}

.material-line-form__actions {
  margin-top: var(--sp-2);
}

.material-line-form__saved {
  margin-top: var(--sp-6);
  gap: var(--sp-3);
}

.material-line-form__saved h2 {
  margin: 0;
  font-size: var(--fs-h3);
}

.material-line-form__entry {
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.material-line-form__entry span,
.material-line-form__empty {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

.material-line-form__entry-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.material-line-form__actions :deep(.p-button) {
  min-height: var(--tap-field);
}

.material-line-form__entry-actions :deep(.p-button) {
  min-height: var(--tap-min);
}

@media (min-width: 720px) {
  .material-line-form {
    padding: var(--sp-6);
  }

  .material-line-form__split {
    grid-template-columns: minmax(0, 1fr) minmax(var(--sp-16), auto);
  }

  .material-line-form__actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: end;
  }
}
</style>
