<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  recoveryCodes: string[];
}>();

const emit = defineEmits<{
  acknowledge: [];
}>();

const hasSavedCodes = ref(false);
const copyStatus = ref<string | null>(null);

const codesText = computed(() => props.recoveryCodes.join('\n'));

async function copyCodes(): Promise<void> {
  await navigator.clipboard.writeText(codesText.value);
  copyStatus.value = 'Copied';
}

function downloadCodes(): void {
  const blob = new Blob([`${codesText.value}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'marinex360-recovery-codes.txt';
  anchor.click();
  URL.revokeObjectURL(url);
}

function acknowledge(): void {
  if (!hasSavedCodes.value) return;
  emit('acknowledge');
}
</script>

<template>
  <div class="recovery-dialog" role="presentation">
    <section
      class="recovery-dialog__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-codes-title"
      aria-describedby="recovery-codes-note"
    >
      <div class="recovery-dialog__header">
        <p class="recovery-dialog__eyebrow">Shown once</p>
        <h2 id="recovery-codes-title" class="recovery-dialog__title">Save recovery codes</h2>
        <p id="recovery-codes-note" class="recovery-dialog__copy">
          These recovery codes are shown once. Only hashed codes are stored server-side, so they cannot be recovered later.
        </p>
      </div>

      <ol class="recovery-dialog__codes">
        <li v-for="code in recoveryCodes" :key="code">
          {{ code }}
        </li>
      </ol>

      <div class="recovery-dialog__actions" aria-live="polite">
        <button class="secondary-button" type="button" @click="copyCodes">
          <span class="pi pi-copy" aria-hidden="true" />
          <span>Copy</span>
        </button>
        <button class="secondary-button" type="button" @click="downloadCodes">
          <span class="pi pi-download" aria-hidden="true" />
          <span>Download</span>
        </button>
        <span v-if="copyStatus" class="recovery-dialog__status">{{ copyStatus }}</span>
      </div>

      <label class="auth-check">
        <input v-model="hasSavedCodes" type="checkbox" />
        <span>I've saved these codes</span>
      </label>

      <button class="auth-button" type="button" :disabled="!hasSavedCodes" @click="acknowledge">
        <span class="pi pi-check" aria-hidden="true" />
        <span>Continue</span>
      </button>
    </section>
  </div>
</template>
