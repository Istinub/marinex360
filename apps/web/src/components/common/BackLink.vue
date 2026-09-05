<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

defineProps<{
  to: RouteLocationRaw;
  label: string;
}>();
</script>

<template>
  <RouterLink class="auth-link back-link" :to="to">
    <span aria-hidden="true">←</span>
    <span>{{ label }}</span>
  </RouterLink>
</template>

<style scoped>
.back-link {
  min-height: auto;
  justify-content: flex-start;
  gap: var(--sp-2);
  margin-bottom: var(--sp-1);
}
</style>
