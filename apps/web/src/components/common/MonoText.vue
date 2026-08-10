<script setup lang="ts">
defineProps<{
  value?: string | number | null;
}>();
</script>

<template>
  <span class="mono-text">{{ value ?? '—' }}</span>
</template>
