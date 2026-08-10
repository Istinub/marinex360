<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiResponseError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const queryEmail = router.currentRoute.value.query.email;
const email = ref(typeof queryEmail === 'string' ? queryEmail : '');
const code = ref('');
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);

async function verifyRecoveryCode(): Promise<void> {
  isSubmitting.value = true;
  errorMessage.value = null;

  try {
    await auth.recoverWithCode({
      email: email.value,
      code: code.value,
    });
    await router.replace('/clients');
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to verify recovery code.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="auth-page" aria-labelledby="recovery-title">
    <form class="auth-panel" @submit.prevent="verifyRecoveryCode">
      <div class="auth-panel__header">
        <p class="auth-panel__eyebrow">Lost device</p>
        <h1 id="recovery-title" class="auth-panel__title">Use a recovery code</h1>
        <p class="auth-panel__copy">
          Recovery codes are single-use. Only hashed codes are stored server-side.
        </p>
      </div>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">
        {{ errorMessage }}
      </p>

      <label class="auth-field" for="recovery-email">
        <span>Email</span>
        <input
          id="recovery-email"
          v-model="email"
          class="auth-input"
          type="email"
          autocomplete="username"
          required
        />
      </label>

      <label class="auth-field" for="recovery-code">
        <span>Recovery code</span>
        <input
          id="recovery-code"
          v-model="code"
          class="auth-input"
          autocomplete="one-time-code"
          required
        />
      </label>

      <button class="auth-button" type="submit" :disabled="isSubmitting">
        <span class="pi pi-key" aria-hidden="true" />
        <span>{{ isSubmitting ? 'Verifying' : 'Verify code' }}</span>
      </button>
    </form>
  </main>
</template>
