<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

const route = useRoute();

const jobOrderId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] : id;
});

const checklistPath = computed(() => `/jobs/${jobOrderId.value}/checklist`);
const materialsPath = computed(() => `/jobs/${jobOrderId.value}/materials`);
const documentsPath = computed(() => `/jobs/${jobOrderId.value}/documents`);
const signaturePath = computed(() => `/jobs/${jobOrderId.value}/sign`);
</script>

<template>
  <main class="job-detail" aria-labelledby="job-detail-title">
    <header class="job-detail__header">
      <div>
        <p class="job-detail__eyebrow">Job execution</p>
        <h1 id="job-detail-title" class="job-detail__title">Job detail</h1>
      </div>
    </header>

    <nav class="job-detail__tabs" aria-label="Job detail sections">
      <RouterLink class="job-detail__tab" :to="checklistPath">
        Checklist
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="materialsPath">
        Materials
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="documentsPath">
        Documents
      </RouterLink>
      <RouterLink class="job-detail__tab" :to="signaturePath">
        Sign
      </RouterLink>
    </nav>
  </main>
</template>

<style scoped>
.job-detail {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.job-detail__header {
  margin-bottom: var(--sp-4);
}

.job-detail__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.job-detail__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.job-detail__tabs {
  display: grid;
  gap: var(--tap-gap);
}

.job-detail__tab {
  min-height: var(--tap-field);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  border: var(--border-2);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
  text-decoration: none;
}

.job-detail__tab.router-link-active {
  border-color: var(--color-brand);
  background: var(--c-navy-050);
}
</style>
