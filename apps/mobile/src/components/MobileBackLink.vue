<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router';

defineProps<{
  to: RouteLocationRaw;
  label?: string;
}>();
</script>

<template>
  <RouterLink class="mobile-back-link" :to="to" :aria-label="label ?? 'Return'">
    <i class="pi pi-arrow-left" aria-hidden="true" />
    <span>{{ label ?? 'Return' }}</span>
  </RouterLink>
</template>

<style scoped>
.mobile-back-link {
  min-height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
  color: var(--color-brand);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  text-decoration: none;
}

.mobile-back-link:focus-visible {
  outline: 2px solid var(--color-field-action);
  outline-offset: 2px;
}
</style>
