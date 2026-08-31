<script setup lang="ts">
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Geolocation } from '@capacitor/geolocation';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { currentUserDisplayName, useOfflineExecution } from '@/composables/useOfflineExecution';

interface OwnerRow {
  execution_owner_id: string | null;
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
    auth?: {
      userId?: string | null;
    };
  };
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

function currentUserId(): string | null {
  return mobileRuntime().marinex360?.auth?.userId ?? null;
}

function strokeColor(): string {
  if (typeof window === 'undefined') return 'CanvasText';
  return getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim() || 'CanvasText';
}

async function captureGeo(): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch {
    return { lat: null, lng: null };
  }
}

const route = useRoute();
const offlineExecution = useOfflineExecution();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const isLoading = ref(false);
const isOwner = ref(false);
const isSubmitting = ref(false);
const hasInk = ref(false);
const confirming = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const form = reactive({
  signerName: currentUserDisplayName(),
  signerRole: '',
});

let ctx: CanvasRenderingContext2D | null = null;
let drawing = false;
let lastPoint: { x: number; y: number } | null = null;

const jobOrderId = computed(() => {
  const id = route.params.id ?? route.params.jobOrderId;
  return (Array.isArray(id) ? id[0] : id) ?? '';
});

async function loadOwnerGate(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  try {
    const adapter = db();
    const userId = currentUserId();
    if (!adapter) throw new Error('Offline job cache is not available on this device.');
    if (!userId) throw new Error('Current user is not available.');

    const rows = await adapter.select<OwnerRow>('SELECT execution_owner_id FROM jo_cache WHERE id=?', [jobOrderId.value]);
    isOwner.value = rows[0]?.execution_owner_id === userId;
    if (isOwner.value) {
      await nextTick();
      resizeCanvas();
    }
  } catch (error) {
    isOwner.value = false;
    errorMessage.value = error instanceof Error ? error.message : 'Unable to check signing access.';
  } finally {
    isLoading.value = false;
  }
}

function resizeCanvas(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));

  ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = strokeColor();
}

function pointFromEvent(event: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function startDraw(event: PointerEvent): void {
  event.preventDefault();
  const canvas = canvasRef.value;
  if (!canvas || !ctx) return;
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  lastPoint = pointFromEvent(event);
}

function draw(event: PointerEvent): void {
  if (!drawing || !ctx || !lastPoint) return;
  event.preventDefault();
  const next = pointFromEvent(event);
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(next.x, next.y);
  ctx.stroke();
  lastPoint = next;
  hasInk.value = true;
  confirming.value = false;
}

function stopDraw(event: PointerEvent): void {
  if (!drawing) return;
  event.preventDefault();
  drawing = false;
  lastPoint = null;
}

function clearPad(): void {
  const canvas = canvasRef.value;
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasInk.value = false;
  confirming.value = false;
  successMessage.value = null;
}

function validate(): boolean {
  errorMessage.value = null;
  successMessage.value = null;

  if (!form.signerName.trim()) errorMessage.value = 'Signer name is required.';
  else if (!form.signerRole.trim()) errorMessage.value = 'Signer role is required.';
  else if (!hasInk.value) errorMessage.value = 'Capture the signature before submitting.';

  return errorMessage.value == null;
}

function canvasBase64(): string {
  const canvas = canvasRef.value;
  if (!canvas) throw new Error('Signature pad is not available.');
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

async function saveSignatureImage(): Promise<string> {
  const path = `signatures/${jobOrderId.value}-${Date.now()}.png`;
  const result = await Filesystem.writeFile({
    path,
    data: canvasBase64(),
    directory: Directory.Data,
    recursive: true,
  });
  return result.uri;
}

async function submitSignature(): Promise<void> {
  if (!isOwner.value || !validate()) return;

  if (!confirming.value) {
    confirming.value = true;
    return;
  }

  isSubmitting.value = true;
  try {
    const geo = await captureGeo();
    const localPath = await saveSignatureImage();
    await offlineExecution.authorESignature(
      jobOrderId.value,
      form.signerName,
      form.signerRole,
      geo.lat,
      geo.lng,
      localPath,
    );
    successMessage.value = 'Signature submitted — this cannot be edited';
    confirming.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to submit signature.';
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  void loadOwnerGate();
  if (typeof window !== 'undefined') window.addEventListener('resize', resizeCanvas);
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', resizeCanvas);
});
</script>

<template>
  <main class="signature-capture" aria-labelledby="signature-title">
    <header class="signature-capture__header">
      <div>
        <p class="signature-capture__eyebrow">Signature</p>
        <h1 id="signature-title" class="signature-capture__title">Capture sign-off</h1>
      </div>
    </header>

    <div v-if="isLoading" class="signature-capture__loading" aria-live="polite">
      <ProgressSpinner class="signature-capture__spinner" stroke-width="4" />
    </div>

    <Message v-else-if="errorMessage" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>

    <Message v-else-if="!isOwner" severity="warn" :closable="false">
      Only the assigned execution owner can sign this job
    </Message>

    <form v-else class="signature-capture__form" @submit.prevent="submitSignature">
      <Message v-if="errorMessage" severity="error" :closable="false">
        {{ errorMessage }}
      </Message>
      <Message v-if="successMessage" severity="success" :closable="false">
        {{ successMessage }}
      </Message>
      <Message v-if="confirming" severity="warn" :closable="false">
        Signature submitted — this cannot be edited
      </Message>

      <label class="signature-capture__field" for="signer-name">
        <span>Signer name</span>
        <InputText id="signer-name" v-model="form.signerName" class="signature-capture__input" autocomplete="name" />
      </label>

      <label class="signature-capture__field" for="signer-role">
        <span>Signer role</span>
        <InputText id="signer-role" v-model="form.signerRole" class="signature-capture__input" autocomplete="organization-title" />
      </label>

      <section class="signature-capture__pad-wrap" aria-label="Signature pad">
        <canvas
          ref="canvasRef"
          class="signature-capture__pad"
          @pointerdown="startDraw"
          @pointermove="draw"
          @pointerup="stopDraw"
          @pointercancel="stopDraw"
          @pointerleave="stopDraw"
        />
      </section>

      <div class="signature-capture__actions">
        <Button type="button" label="Clear" severity="secondary" icon="pi pi-eraser" @click="clearPad" />
        <Button
          type="submit"
          :label="confirming ? 'Confirm and submit' : 'Submit signature'"
          icon="pi pi-check"
          :loading="isSubmitting"
        />
      </div>
    </form>
  </main>
</template>

<style scoped>
.signature-capture {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.signature-capture__header {
  margin-bottom: var(--sp-4);
}

.signature-capture__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.signature-capture__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.signature-capture__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-8);
}

.signature-capture__spinner {
  width: var(--tap-min);
  height: var(--tap-min);
}

.signature-capture__form,
.signature-capture__field,
.signature-capture__actions {
  display: grid;
  gap: var(--sp-3);
}

.signature-capture__form {
  gap: var(--sp-4);
}

.signature-capture__field span {
  color: var(--color-text);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.signature-capture__input {
  width: 100%;
  min-height: var(--tap-field);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
}

.signature-capture__pad-wrap {
  min-height: 240px;
  padding: var(--sp-2);
  border: var(--border-2);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.signature-capture__pad {
  width: 100%;
  min-height: 220px;
  display: block;
  border: var(--border-1);
  border-radius: var(--radius-sm);
  background: var(--color-canvas);
  touch-action: none;
}

.signature-capture__actions {
  grid-template-columns: 1fr;
}

.signature-capture__actions :deep(.p-button) {
  min-height: var(--tap-field);
}

@media (min-width: 720px) {
  .signature-capture {
    padding: var(--sp-6);
  }

  .signature-capture__actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
    justify-content: end;
  }
}
</style>
