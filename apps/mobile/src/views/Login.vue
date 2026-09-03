<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { computed, nextTick, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LoginError, useAuth, type LoginErrorKind } from '@/composables/useAuth';

const auth = useAuth();
const route = useRoute();
const router = useRouter();

const form = reactive({
  email: '',
  password: '',
  totp: '',
});
const showTotp = ref(false);
const isSubmitting = ref(false);
const errorKind = ref<LoginErrorKind | null>(null);
const errorMessage = ref<string | null>(null);
const mfaEnrollmentRequired = ref(false);
const totpInput = ref<HTMLInputElement | null>(null);

const messageSeverity = computed(() => errorKind.value === 'totp-required' ? 'warn' : 'error');

function intendedDestination(): string {
  const redirect = route.query.redirect;
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) return '/jobs';
  return redirect;
}

function setLoginError(kind: LoginErrorKind): void {
  errorKind.value = kind;
  const messages: Record<LoginErrorKind, string> = {
    credentials: 'Email or password is incorrect.',
    'totp-required': 'Enter the six-digit code from your authenticator app.',
    'totp-invalid': 'The authenticator code is invalid. Check the code and try again.',
    network: 'Unable to reach the server. Check your connection and try again.',
    request: 'Sign in could not be completed. Please try again.',
  };
  errorMessage.value = messages[kind];
}

async function submit(): Promise<void> {
  errorKind.value = null;
  errorMessage.value = null;
  mfaEnrollmentRequired.value = false;

  if (showTotp.value && !form.totp.trim()) {
    setLoginError('totp-required');
    return;
  }

  isSubmitting.value = true;
  try {
    const result = await auth.login(
      form.email,
      form.password,
      showTotp.value ? form.totp : undefined,
    );
    mfaEnrollmentRequired.value = result.mfaEnrollmentRequired;

    if (result.mfaEnrollmentRequired) {
      await router.replace({ path: '/jobs', query: { mfaEnrollmentRequired: 'true' } });
      return;
    }

    await router.replace(intendedDestination());
  } catch (error) {
    if (error instanceof LoginError) {
      setLoginError(error.kind);
      if (error.kind === 'totp-required') {
        showTotp.value = true;
        await nextTick();
        totpInput.value?.focus();
      }
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
          <p class="login__eyebrow">MarineX360 Mobile</p>
          <h1 id="login-title" class="login__title">Sign in</h1>
          <p class="login__intro">Use your assigned account to access jobs saved on this device.</p>
        </header>

        <Message v-if="errorMessage" :severity="messageSeverity" :closable="false">
          {{ errorMessage }}
        </Message>

        <Message v-if="mfaEnrollmentRequired" severity="warn" :closable="false">
          Multi-factor authentication enrollment is still required for this account.
        </Message>

        <form class="login__form" novalidate @submit.prevent="submit">
          <div class="login__field">
            <label for="email">Email</label>
            <InputText
              id="email"
              v-model="form.email"
              class="login__control"
              type="email"
              autocomplete="email"
              inputmode="email"
              required
              fluid
            />
          </div>

          <div class="login__field">
            <label for="password">Password</label>
            <Password
              v-model="form.password"
              class="login__control"
              input-id="password"
              autocomplete="current-password"
              :feedback="false"
              toggle-mask
              required
              fluid
            />
          </div>

          <div v-if="showTotp" class="login__field">
            <label for="totp">Authenticator code</label>
            <InputText
              id="totp"
              ref="totpInput"
              v-model="form.totp"
              class="login__control login__totp"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              pattern="[0-9]*"
              required
              fluid
            />
          </div>

          <Button
            type="submit"
            label="Sign in"
            icon="pi pi-sign-in"
            class="login__submit"
            :loading="isSubmitting"
          />
        </form>
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

.login__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
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
  gap: var(--sp-4);
  margin-top: var(--sp-4);
}

.login__field {
  display: grid;
  gap: var(--sp-2);
}

.login__field label {
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.login__control,
.login__submit {
  width: 100%;
  min-height: var(--tap-min);
}

.login__control :deep(input),
.login__control:deep(input),
.login__totp {
  min-height: var(--tap-min);
  font-size: var(--fs-body);
}

.login__totp {
  font-family: var(--font-code);
  letter-spacing: 0.2em;
}

.login__submit {
  margin-top: var(--sp-2);
}
</style>
