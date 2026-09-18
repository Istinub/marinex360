<script setup lang="ts">
import Button from 'primevue/button';
import Select from 'primevue/select';
import { computed } from 'vue';
import FieldError from '@/components/common/FieldError.vue';
import { materialUnitOptions } from '@/lib/materialUnits';
import { formatMoney } from '@/lib/money';

interface MaterialLineDraft {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: {
    amountMinor: string;
    currency: string;
  };
}

const props = defineProps<{
  line: MaterialLineDraft;
  currency?: string;
  canRemove?: boolean;
  errors?: Partial<Record<keyof MaterialLineDraft, string>>;
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

const amountMinor = computed(() => {
  const quantity = Number(props.line.quantity);
  const unitCost = Number(props.line.unitCost.amountMinor);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return 0;
  return Math.round(quantity * unitCost);
});

const amountLabel = computed(() =>
  formatMoney({
    amountMinor: amountMinor.value,
    currency: props.currency || props.line.unitCost.currency || 'SGD',
  }),
);

const visibleUnitOptions = computed(() => {
  if (!props.line.unit || materialUnitOptions.some((option) => option.value === props.line.unit)) return materialUnitOptions;
  return [{ label: props.line.unit, value: props.line.unit }, ...materialUnitOptions];
});
</script>

<template>
  <div class="material-line-row">
    <label class="auth-field" :for="`material-description-${line.id}`">
      <span>Description</span>
      <input :id="`material-description-${line.id}`" v-model="line.description" class="auth-input" required />
      <FieldError :message="errors?.description" />
    </label>

    <label class="auth-field" :for="`material-quantity-${line.id}`">
      <span>Qty</span>
      <input :id="`material-quantity-${line.id}`" v-model="line.quantity" class="auth-input mono-input" inputmode="decimal" required />
      <FieldError :message="errors?.quantity" />
    </label>

    <label class="auth-field" :for="`material-unit-${line.id}`">
      <span>Unit</span>
      <Select
        :id="`material-unit-${line.id}`"
        v-model="line.unit"
        class="auth-input material-line-row__select"
        :options="visibleUnitOptions"
        option-label="label"
        option-value="value"
        placeholder="Select unit"
        required
      />
      <FieldError :message="errors?.unit" />
    </label>

    <label class="auth-field" :for="`material-unit-cost-${line.id}`">
      <span>Unit cost</span>
      <input
        :id="`material-unit-cost-${line.id}`"
        v-model="line.unitCost.amountMinor"
        class="auth-input mono-input"
        inputmode="numeric"
        required
      />
      <FieldError :message="errors?.unitCost" />
    </label>

    <div class="material-line-row__amount">
      <span>Amount</span>
      <span class="mx-money">{{ amountLabel }}</span>
    </div>

    <Button
      v-if="canRemove"
      type="button"
      icon="pi pi-trash"
      severity="secondary"
      text
      aria-label="Remove line"
      @click="emit('remove', line.id)"
    />
  </div>
</template>
