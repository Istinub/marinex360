<script setup lang="ts">
import QRCode from 'qrcode';
import { onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import RecoveryCodesDialog from '@/components/common/RecoveryCodesDialog.vue';
import { ApiResponseError } from '@/lib/api/errors';
import { post } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth';

interface TotpEnrollResponse {
  provisioningUri: string;
  secretMasked: string;
}

interface TotpConfirmResponse {
  recoveryCodes: string[];
}

const router = useRouter();
const auth = useAuthStore();

const qrSvg = ref('');
const secretMasked = ref('');
const code = ref('');
const recoveryCodes = ref<string[]>([]);
const isLoading = ref(true);
const isConfirming = ref(false);
const hasAcknowledgedRecoveryCodes = ref(false);
const errorMessage = ref<string | null>(null);

onMounted(async () => {
  try {
    const enrollment = await post<TotpEnrollResponse>('/auth/totp/enroll');
    secretMasked.value = enrollment.secretMasked;
    qrSvg.value = await QRCode.toString(enrollment.provisioningUri, {
      type: 'svg',
      margin: 1,
      width: 220,
    });
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to start MFA enrolment.';
  } finally {
    isLoading.value = false;
  }
});

onBeforeRouteLeave(() => {
  if (recoveryCodes.value.length > 0 && !hasAcknowledgedRecoveryCodes.value) return false;
  return true;
});

async function confirmEnrollment(): Promise<void> {
  isConfirming.value = true;
  errorMessage.value = null;

  try {
    const response = await post<TotpConfirmResponse, { code: string }>('/auth/totp/enroll/confirm', {
      code: code.value,
    });
    recoveryCodes.value = response.recoveryCodes;
  } catch (error) {
    errorMessage.value = error instanceof ApiResponseError ? error.message : 'Unable to confirm authentication code.';
  } finally {
    isConfirming.value = false;
  }
}

async function acknowledgeRecoveryCodes(): Promise<void> {
  hasAcknowledgedRecoveryCodes.value = true;
  await auth.completeMfaEnrollment();
  await router.replace('/clients');
}
</script>

<template>
  <main class="office-route mfa-enroll" aria-labelledby="mfa-enroll-title">
    <div class="mfa-enroll__panel">
      <p class="mfa-enroll__eyebrow">Account security</p>
      <h1 id="mfa-enroll-title" class="mfa-enroll__title">MFA enrolment required</h1>
      <p class="mfa-enroll__copy">
        Scan the QR code with your authenticator app, then enter the 6-digit code to finish enrolment.
      </p>

      <p v-if="errorMessage" class="auth-message auth-message--error" role="alert">
        {{ errorMessage }}
      </p>

      <div v-if="isLoading" class="mfa-enroll__loading">Loading enrolment...</div>

      <template v-else>
        <div v-if="qrSvg" class="mfa-enroll__qr" aria-label="Authenticator QR code" v-html="qrSvg" />

        <p v-if="secretMasked" class="mfa-enroll__manual">
          Manual entry: <span>{{ secretMasked }}</span>
        </p>

        <form class="mfa-enroll__form" @submit.prevent="confirmEnrollment">
          <label class="auth-field" for="mfa-code">
            <span>Authentication code</span>
            <input
              id="mfa-code"
              v-model="code"
              class="auth-input"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              pattern="[0-9]{6}"
              required
            />
          </label>

          <button class="auth-button" type="submit" :disabled="isConfirming">
            <span class="pi pi-shield" aria-hidden="true" />
            <span>{{ isConfirming ? 'Confirming' : 'Confirm enrolment' }}</span>
          </button>
        </form>
      </template>
    </div>

    <RecoveryCodesDialog
      v-if="recoveryCodes.length > 0"
      :recovery-codes="recoveryCodes"
      @acknowledge="acknowledgeRecoveryCodes"
    />
  </main>
</template>
