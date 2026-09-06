<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Message from 'primevue/message';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LoginError, useAuth, type LoginErrorKind } from '@/composables/useAuth';

const auth = useAuth();
const route = useRoute();
const router = useRouter();

const pin = ref('');
const isSubmitting = ref(false);
const errorKind = ref<LoginErrorKind | null>(null);
const errorMessage = ref<string | null>(null);

const maskedPin = computed(() => pin.value.padEnd(4, ' ').split('').map((digit) => (digit.trim() ? '*' : 'o')));

function intendedDestination(): string {
  const redirect = route.query.redirect;
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) return '/jobs';
  return redirect;
}

function setLoginError(kind: LoginErrorKind, message?: string): void {
  errorKind.value = kind;
  const messages: Record<LoginErrorKind, string> = {
    credentials: 'PIN is incorrect.',
    'totp-required': 'This device requires setup by an administrator.',
    'totp-invalid': 'Device unlock could not be completed.',
    network: 'Unable to reach the server. Check your connection and try again.',
    request: message ?? 'Device unlock could not be completed. Please try again.',
  };
  errorMessage.value = messages[kind];
}

function pressDigit(value: string): void {
  errorMessage.value = null;
  if (pin.value.length >= 4) return;
  pin.value += value;
}

function backspace(): void {
  pin.value = pin.value.slice(0, -1);
}

async function submit(): Promise<void> {
  errorKind.value = null;
  errorMessage.value = null;

  if (!/^\d{4}$/.test(pin.value)) {
    setLoginError('request', 'Enter the four-digit PIN.');
    return;
  }

  isSubmitting.value = true;
  try {
    await auth.unlockDevice(pin.value);
    await router.replace(intendedDestination());
  } catch (error) {
    pin.value = '';
    if (error instanceof LoginError) {
      setLoginError(error.kind, error.message);
      return;
    }
    setLoginError('request');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="login" aria-labelledby="login-title">
    <Card class="login__card">
      <template #content>
        <header class="login__header">
          <h1 id="login-title" class="login__title">MarineX360 Mobile</h1>
          <p class="login__intro">Type your PIN to access the app.</p>
        </header>

        <Message v-if="errorMessage" :severity="errorKind === 'request' ? 'warn' : 'error'" :closable="false">
          {{ errorMessage }}
        </Message>

        <form class="login__form" novalidate @submit.prevent="submit">
          <div class="login__pin" aria-label="PIN">
            <span v-for="(digit, index) in maskedPin" :key="index">{{ digit }}</span>
          </div>

          <div class="login__pad" aria-label="PIN pad">
            <button v-for="digit in ['1','2','3','4','5','6','7','8','9']" :key="digit" type="button" @click="pressDigit(digit)">
              {{ digit }}
            </button>
            <button type="button" @click="backspace">Back</button>
            <button type="button" @click="pressDigit('0')">0</button>
            <Button type="submit" icon="pi pi-check" aria-label="Unlock" :loading="isSubmitting" />
          </div>
        </form>

        <p class="login__help">Forgot your PIN? Contact your supervisor or IT.</p>
      </template>
    </Card>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  min-height: 100vh;
  padding: max(var(--sp-6), env(safe-area-inset-top)) max(var(--sp-4), env(safe-area-inset-right)) max(var(--sp-6), env(safe-area-inset-bottom)) max(var(--sp-4), env(safe-area-inset-left));
  place-items: center;
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.login__card {
  width: min(100%, 28rem);
  border: var(--border-1);
  border-radius: var(--radius-lg);
}

.login__header {
  margin-bottom: var(--sp-6);
}

.login__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.login__intro {
  margin: var(--sp-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body);
  line-height: var(--lh-base);
}

.login__form {
  display: grid;
  gap: var(--sp-3);
}

.login__form {
  margin-top: var(--sp-4);
}

.login__pin {
  display: flex;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-4) 0;
  color: var(--color-text);
  font-size: var(--fs-h2);
  font-family: var(--font-code);
}

.login__pad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--tap-gap);
}

.login__pad button,
.login__pad :deep(.p-button) {
  min-height: var(--tap-field);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
}

.login__help {
  margin: var(--sp-5) 0 0;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
  text-align: center;
}
</style>
