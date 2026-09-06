<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  description: string;
  items?: string[];
}>();
</script>

<template>
  <main class="office-route crm-page" :aria-labelledby="`${title}-title`">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">{{ eyebrow }}</p>
        <h1 :id="`${title}-title`" class="crm-page__title">{{ title }}</h1>
        <p class="record-form__version">{{ description }}</p>
      </div>
    </header>

    <section v-if="items?.length" class="crm-section" aria-label="Planned items">
      <ul class="placeholder-list">
        <li v-for="item in items" :key="item">{{ item }}</li>
      </ul>
    </section>
  </main>
</template>
