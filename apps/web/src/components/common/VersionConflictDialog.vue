<script setup lang="ts">
defineProps<{
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div class="version-dialog" role="presentation">
    <section
      class="version-dialog__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-conflict-title"
    >
      <div class="version-dialog__header">
        <p class="version-dialog__eyebrow">Version conflict</p>
        <h2 id="version-conflict-title" class="version-dialog__title">Fresh data loaded</h2>
        <p class="version-dialog__copy">
          This record changed while you were editing. Your edits are still staged against the latest version.
        </p>
      </div>

      <div class="version-dialog__actions">
        <button class="secondary-button" type="button" @click="emit('cancel')">
          Cancel
        </button>
        <button class="auth-button" type="button" :disabled="isSaving" @click="emit('confirm')">
          <span class="pi pi-save" aria-hidden="true" />
          <span>{{ isSaving ? 'Saving' : 'Save staged edits' }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
