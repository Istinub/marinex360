<script setup lang="ts">
defineProps<{
  title?: string;
  message?: string;
}>();
</script>

<template>
  <main class="not-found-state" aria-labelledby="not-found-title">
    <p class="not-found-state__eyebrow">Not found</p>
    <h1 id="not-found-title" class="not-found-state__title">
      {{ title ?? 'Record not found' }}
    </h1>
    <p class="not-found-state__message">
      {{ message ?? 'The requested record could not be found.' }}
    </p>
  </main>
</template>
