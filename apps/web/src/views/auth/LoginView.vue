<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiResponseError } from '@/lib/api/errors';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const totp = ref('');
const showTotp = ref(false);
const isSubmitting = ref(false);
const formError = ref<string | null>(null);
const totpError = ref<string | null>(null);
const totpInput = ref<HTMLInputElement | null>(null);

async function focusTotp(message: string): Promise<void> {
  showTotp.value = true;
  totpError.value = message;
  formError.value = null;
  await nextTick();
  totpInput.value?.focus();
}

async function submitLogin(): Promise<void> {
  isSubmitting.value = true;
  formError.value = null;
  totpError.value = null;

  try {
    await auth.login({
      email: email.value,
      password: password.value,
      totp: totp.value || undefined,
    });

    const redirect = router.currentRoute.value.query.redirect;
    await router.replace(auth.mfaEnrollmentRequired ? '/mfa/enroll' : typeof redirect === 'string' ? redirect : '/clients');
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 'UNAUTHORIZED' && error.message === 'valid TOTP required') {
      await focusTotp(totp.value ? 'Authentication code could not be verified.' : 'Authentication code is required for this account.');
      return;
    }

    formError.value = error instanceof ApiResponseError ? error.message : 'Unable to sign in.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="auth-page" aria-labelledby="login-title">
    <form class="auth-panel" @submit.prevent="submitLogin">
      <div class="auth-panel__header">
        <p class="auth-panel__eyebrow">MarineX360 Office</p>
        <h1 id="login-title" class="auth-panel__title">Sign in</h1>
      </div>

      <p v-if="formError" class="auth-message auth-message--error" role="alert">
        {{ formError }}
      </p>

      <label class="auth-field" for="email">
        <span>Email</span>
        <input
          id="email"
          v-model="email"
          class="auth-input"
          type="email"
          autocomplete="username"
          required
        />
      </label>

      <label class="auth-field" for="password">
        <span>Password</span>
        <input
          id="password"
          v-model="password"
          class="auth-input"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>

      <label v-if="showTotp" class="auth-field" for="totp">
        <span>Authentication code</span>
        <input
          id="totp"
          ref="totpInput"
          v-model="totp"
          class="auth-input"
          inputmode="numeric"
          autocomplete="one-time-code"
          aria-describedby="totp-message"
        />
        <span v-if="totpError" id="totp-message" class="auth-field__message" role="alert">
          {{ totpError }}
        </span>
      </label>

      <button class="auth-button" type="submit" :disabled="isSubmitting">
        <span class="pi pi-lock" aria-hidden="true" />
        <span>{{ isSubmitting ? 'Signing in' : 'Sign in' }}</span>
      </button>

      <RouterLink class="auth-link" :to="{ path: '/mfa/recovery', query: email ? { email } : undefined }">
        Lost device?
      </RouterLink>
    </form>
  </main>
</template>
