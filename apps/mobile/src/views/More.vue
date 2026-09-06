<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/composables/useAuth';
import { loadTodayActivity, type TodayActivity } from '@/composables/useTodayActivity';

const router = useRouter();
const auth = useAuth();
const isLocking = ref(false);
const isLoadingActivity = ref(false);
const errorMessage = ref<string | null>(null);
const activity = ref<TodayActivity>({
  checklistItemsTicked: 0,
  observationsAdded: 0,
  jobsOpened: 0,
});

async function lockDevice(): Promise<void> {
  isLocking.value = true;
  errorMessage.value = null;

  try {
    await auth.logout();
    await router.replace('/login');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to lock device.';
  } finally {
    isLocking.value = false;
  }
}

async function loadActivity(): Promise<void> {
  isLoadingActivity.value = true;
  errorMessage.value = null;

  try {
    activity.value = await loadTodayActivity();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load today\'s activity.';
  } finally {
    isLoadingActivity.value = false;
  }
}

onMounted(() => {
  void loadActivity();
});
</script>

<template>
  <main class="more" aria-labelledby="more-title">
    <header class="more__header">
      <p class="more__eyebrow">Device</p>
      <h1 id="more-title">More</h1>
    </header>

    <Message v-if="errorMessage" severity="warn" :closable="false">{{ errorMessage }}</Message>

    <section class="more__section" aria-labelledby="lock-device-title">
      <div>
        <h2 id="lock-device-title">Lock device</h2>
        <p>End this technician session and return to PIN entry.</p>
      </div>
      <Button
        class="more__lock-button"
        label="Lock device"
        icon="pi pi-lock"
        severity="danger"
        :loading="isLocking"
        @click="lockDevice"
      />
    </section>

    <section class="more__section" aria-labelledby="support-title">
      <h2 id="support-title">Help &amp; Support</h2>
      <p>Forgot your PIN? Contact your supervisor or IT.</p>
      <ul class="more__support-list">
        <li>Sync stuck? Check your connection and tap the sync icon.</li>
        <li>Camera not working? Check app permissions in your device settings.</li>
        <li>Job data missing? Reopen the Jobs tab after reconnecting.</li>
      </ul>
    </section>

    <section class="more__section" aria-labelledby="activity-title">
      <div class="more__section-header">
        <h2 id="activity-title">Today's activity</h2>
        <Button
          type="button"
          icon="pi pi-refresh"
          aria-label="Refresh today's activity"
          rounded
          severity="secondary"
          :loading="isLoadingActivity"
          @click="loadActivity"
        />
      </div>

      <div v-if="isLoadingActivity" class="more__loading" aria-live="polite">
        <ProgressSpinner stroke-width="4" />
      </div>
      <dl v-else class="more__activity-list">
        <div class="more__activity-row">
          <dt>Checklist items ticked</dt>
          <dd>{{ activity.checklistItemsTicked }}</dd>
        </div>
        <div class="more__activity-row">
          <dt>Observations added</dt>
          <dd>{{ activity.observationsAdded }}</dd>
        </div>
        <div class="more__activity-row">
          <dt>Jobs opened</dt>
          <dd>{{ activity.jobsOpened }}</dd>
        </div>
      </dl>
    </section>
  </main>
</template>

<style scoped>
.more {
  display: grid;
  gap: var(--sp-4);
  min-height: 100%;
  padding: var(--sp-4);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.more__header h1,
.more__section h2 {
  margin: 0;
}

.more__header h1 {
  font-size: var(--fs-h1);
}

.more__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-weight: var(--fw-semibold);
}

.more__section {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.more__section h2 {
  font-size: var(--fs-h3);
}

.more__section p {
  margin: var(--sp-1) 0 0;
  color: var(--color-text-muted);
  line-height: var(--lh-base);
}

.more__lock-button {
  min-height: var(--tap-field);
  width: 100%;
}

.more__support-list,
.more__activity-list {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
}

.more__support-list {
  padding-inline-start: var(--sp-5);
  color: var(--color-text);
  line-height: var(--lh-base);
}

.more__section-header,
.more__activity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.more__section-header :deep(.p-button) {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
}

.more__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
}

.more__loading :deep(.p-progressspinner) {
  width: var(--tap-min);
  height: var(--tap-min);
}

.more__activity-list {
  padding: 0;
}

.more__activity-row {
  min-height: var(--tap-min);
  padding: var(--sp-2) 0;
  border-bottom: var(--border-1);
}

.more__activity-row:last-child {
  border-bottom: 0;
}

.more__activity-row dt {
  color: var(--color-text);
  font-weight: var(--fw-semibold);
}

.more__activity-row dd {
  margin: 0;
  color: var(--color-brand);
  font-size: var(--fs-h3);
  font-weight: var(--fw-bold);
}
</style>
