<script setup lang="ts">
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import {
  deleteUnsyncedLocalEntry,
  listLocalObservations,
  observationTemplateKey,
  updateLocalObservation,
  type LocalObservationEntry,
} from '@/composables/useLocalExecutionEntries';
import { useOfflineExecution } from '@/composables/useOfflineExecution';

const route = useRoute();
const offlineExecution = useOfflineExecution();

const isSubmitting = ref(false);
const successMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const fieldErrors = reactive<{ body?: string }>({});
const attachedPhotos = ref<{ opId: string; source: 'Camera' | 'Gallery' }[]>([]);
const observations = ref<LocalObservationEntry[]>([]);
const editingEntry = ref<LocalObservationEntry | null>(null);
const form = reactive({
  body: '',
});

const jobOrderId = computed(() => {
  const id = route.params.id ?? route.params.jobOrderId;
  return (Array.isArray(id) ? id[0] : id) ?? '';
});

function validate(): boolean {
  fieldErrors.body = undefined;
  errorMessage.value = null;
  successMessage.value = null;

  if (!form.body.trim()) fieldErrors.body = 'Observation is required.';
  return !fieldErrors.body;
}

function resetForm(): void {
  form.body = '';
  attachedPhotos.value = [];
  editingEntry.value = null;
}

function summaryText(body: string): string {
  return body.length > 60 ? `${body.slice(0, 60)}...` : body;
}

async function refreshEntries(): Promise<void> {
  observations.value = await listLocalObservations(jobOrderId.value);
}

async function captureGeo(): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return { lat: null, lng: null };
  }
}

async function attachPhoto(source: CameraSource.Camera | CameraSource.Photos): Promise<void> {
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Uri,
      source,
    });
    const localPath = photo.path ?? photo.webPath;
    if (!localPath) throw new Error('Photo picker did not return a local photo path.');

    const geo = await captureGeo();
    const queued = await offlineExecution.authorPhotoCapture(jobOrderId.value, 'DURING', localPath, geo.lat, geo.lng);
    attachedPhotos.value = [
      ...attachedPhotos.value,
      { opId: queued.opId, source: source === CameraSource.Camera ? 'Camera' : 'Gallery' },
    ];
    successMessage.value = 'Photo attached.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to attach photo.';
  }
}

async function submitObservation(addAnother = false): Promise<void> {
  if (!validate()) return;

  isSubmitting.value = true;
  try {
    const photoOpIds = attachedPhotos.value.map((photo) => photo.opId);
    if (editingEntry.value) {
      await updateLocalObservation(editingEntry.value, jobOrderId.value, form.body, photoOpIds);
      successMessage.value = 'Observation updated.';
    } else {
      await offlineExecution.authorObservation(jobOrderId.value, form.body, observationTemplateKey(photoOpIds), photoOpIds);
      successMessage.value = 'Observation queued.';
    }
    await refreshEntries();
    resetForm();

    if (addAnother) {
      return;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to queue observation.';
  } finally {
    isSubmitting.value = false;
  }
}

function editObservation(entry: LocalObservationEntry): void {
  editingEntry.value = entry;
  form.body = entry.body;
  attachedPhotos.value = entry.photoOpIds.map((opId) => ({ opId, source: 'Camera' }));
  successMessage.value = null;
  errorMessage.value = null;
}

async function deleteObservation(entry: LocalObservationEntry): Promise<void> {
  try {
    await deleteUnsyncedLocalEntry('Observation', entry.id);
    if (editingEntry.value?.id === entry.id) resetForm();
    successMessage.value = 'Observation deleted.';
    await refreshEntries();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to delete observation.';
  }
}

onMounted(() => {
  void refreshEntries().catch((error) => {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load observations.';
  });
});
</script>

<template>
  <main class="observation-form" aria-labelledby="observation-title">
    <header class="observation-form__header">
      <div>
        <MobileBackLink :to="`/jobs/${jobOrderId}`" label="Return" />
        <p class="observation-form__eyebrow">Observation</p>
        <h1 id="observation-title" class="observation-form__title">Add observation</h1>
      </div>
    </header>

    <Message v-if="successMessage" severity="success" :closable="false">
      {{ successMessage }}
    </Message>

    <Message v-if="errorMessage" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>

    <form class="observation-form__body" @submit.prevent="submitObservation(false)">
      <label class="observation-form__field" for="observation-body">
        <span>Description / observation</span>
        <Textarea
          id="observation-body"
          v-model="form.body"
          class="observation-form__input"
          rows="7"
          auto-resize
          required
        />
        <small v-if="fieldErrors.body" class="observation-form__error">{{ fieldErrors.body }}</small>
      </label>

      <section class="observation-form__photos" aria-labelledby="observation-photos-title">
        <h2 id="observation-photos-title">Photos</h2>
        <div class="observation-form__photo-actions">
          <Button type="button" label="Take photo" icon="pi pi-camera" severity="secondary" @click="attachPhoto(CameraSource.Camera)" />
          <Button type="button" label="Choose from gallery" icon="pi pi-image" severity="secondary" @click="attachPhoto(CameraSource.Photos)" />
        </div>
        <ul v-if="attachedPhotos.length > 0" class="observation-form__photo-list">
          <li v-for="photo in attachedPhotos" :key="photo.opId">
            <span>{{ photo.source }}</span>
            <small>{{ photo.opId }}</small>
          </li>
        </ul>
      </section>

      <div class="observation-form__actions">
        <Button
          type="button"
          label="Save and add another"
          severity="secondary"
          :loading="isSubmitting"
          @click="submitObservation(true)"
        />
        <Button type="submit" :label="editingEntry ? 'Update' : 'Save observation'" icon="pi pi-save" :loading="isSubmitting" />
      </div>
    </form>

    <section class="observation-form__saved" aria-labelledby="saved-observations-title">
      <h2 id="saved-observations-title">Saved this session</h2>
      <p v-if="observations.length === 0" class="observation-form__empty">No observations saved yet.</p>
      <article v-for="entry in observations" :key="entry.id" class="observation-form__entry">
        <div>
          <strong>{{ summaryText(entry.body) }}</strong>
          <span>{{ entry.photoOpIds.length }} photos · {{ entry.syncState }}</span>
        </div>
        <div class="observation-form__entry-actions">
          <Button type="button" label="Edit" severity="secondary" outlined @click="editObservation(entry)" />
          <Button type="button" label="Delete" severity="secondary" outlined @click="deleteObservation(entry)" />
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.observation-form {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.observation-form__header {
  margin-bottom: var(--sp-4);
}

.observation-form__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.observation-form__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.observation-form__body,
.observation-form__field,
.observation-form__photos,
.observation-form__photo-actions,
.observation-form__saved,
.observation-form__entry,
.observation-form__entry-actions,
.observation-form__actions {
  display: grid;
  gap: var(--sp-3);
}

.observation-form__field span {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.observation-form__photos {
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.observation-form__photos h2 {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: var(--fw-semibold);
}

.observation-form__photo-list {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.observation-form__photo-list li {
  display: grid;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: var(--border-1);
  border-radius: var(--radius-sm);
}

.observation-form__photo-list span {
  font-weight: var(--fw-semibold);
}

.observation-form__photo-list small {
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}

.observation-form__saved {
  margin-top: var(--sp-6);
}

.observation-form__saved h2 {
  margin: 0;
  font-size: var(--fs-h3);
}

.observation-form__entry {
  padding: var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.observation-form__entry span,
.observation-form__empty {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
}

.observation-form__entry-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.observation-form__input {
  width: 100%;
  min-height: calc(var(--tap-field) * 3);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}

.observation-form__error {
  color: var(--status-error-fg);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
}

.observation-form__actions {
  margin-top: var(--sp-2);
}

.observation-form__actions :deep(.p-button) {
  min-height: var(--tap-field);
}

.observation-form__photo-actions :deep(.p-button) {
  min-height: var(--tap-field);
}

.observation-form__entry-actions :deep(.p-button) {
  min-height: var(--tap-min);
}

@media (min-width: 720px) {
  .observation-form {
    padding: var(--sp-6);
  }

  .observation-form__actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: end;
  }

  .observation-form__photo-actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
  }
}
</style>
