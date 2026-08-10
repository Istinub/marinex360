<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <main class="office-route" :aria-label="label" />
</template>
