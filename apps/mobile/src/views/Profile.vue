<script setup lang="ts">
import { Preferences } from '@capacitor/preferences';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { currentSessionSnapshot, useAuth, type MobileSession } from '@/composables/useAuth';
import { apiBase, type MobileSqlAdapter } from '@/composables/useOfflineExecution';
import mobilePackage from '../../package.json';

interface CertificateRow {
  id: string;
  ownerType: 'TECHNICIAN';
  ownerId: string;
  certType: string;
  expiresAt: string;
}

interface CachedCertificateRow {
  id: string;
  owner_type: 'TECHNICIAN';
  owner_id: string;
  cert_type: string;
  expires_at: string;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
  };
}

const BIOMETRIC_KEY = 'marinex360.auth.biometric-ui-preference';
const APP_VERSION = mobilePackage.version;
const router = useRouter();
const auth = useAuth();
const session = ref<MobileSession | null>(currentSessionSnapshot());
const certificates = ref<CertificateRow[]>([]);
const pendingCount = ref(0);
const biometricEnabled = ref(false);
const errorMessage = ref<string | null>(null);

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function roleLabel(roles: string[]): string {
  return roles.map((role) => role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())).join(', ') || 'Field user';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function isExpired(certificate: CertificateRow): boolean {
  return new Date(certificate.expiresAt).getTime() < Date.now();
}

function isExpiringSoon(certificate: CertificateRow): boolean {
  const expiry = new Date(certificate.expiresAt).getTime();
  return !isExpired(certificate) && expiry <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

async function loadCertificates(userId: string): Promise<void> {
  const db = mobileRuntime().marinex360?.db;
  if (db) {
    try {
      const rows = await db.select<CachedCertificateRow>(
        `SELECT id, owner_type, owner_id, cert_type, expires_at
         FROM certificate_cache
         WHERE owner_type='TECHNICIAN' AND owner_id=?
         ORDER BY expires_at ASC`,
        [userId],
      );
      certificates.value = rows.map((row) => ({
        id: row.id,
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        certType: row.cert_type,
        expiresAt: row.expires_at,
      }));
      return;
    } catch {
      // Fall through to the live endpoint when the optional certificate cache is unavailable.
    }
  }

  try {
    const response = await auth.authenticatedFetch(`${apiBase()}/certificates?ownerType=TECHNICIAN&ownerId=${encodeURIComponent(userId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Unable to load certifications.');
    certificates.value = await response.json() as CertificateRow[];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load certifications.';
  }
}

async function loadPendingCount(): Promise<void> {
  const db = mobileRuntime().marinex360?.db;
  if (!db) return;

  try {
    const rows = await db.select<{ n: number | string }>('SELECT COUNT(*) AS n FROM op_queue');
    pendingCount.value = Number(rows[0]?.n ?? 0);
  } catch {
    pendingCount.value = 0;
  }
}

async function loadProfile(): Promise<void> {
  session.value = session.value ?? await auth.currentSession();
  const current = session.value;
  if (!current) return;

  const preference = await Preferences.get({ key: BIOMETRIC_KEY });
  biometricEnabled.value = preference.value === 'true';
  await Promise.all([loadCertificates(current.userId), loadPendingCount()]);
}

async function setBiometricPreference(enabled: boolean): Promise<void> {
  // UI preference only — does not yet gate the session per OD-04; real biometric enforcement is separate scope
  biometricEnabled.value = enabled;
  await Preferences.set({ key: BIOMETRIC_KEY, value: String(enabled) });
}

async function signOut(): Promise<void> {
  await auth.logout();
  await router.replace('/login');
}

onMounted(() => {
  void loadProfile();
});

const identityLabel = computed(() => session.value ? roleLabel(session.value.roles) : 'Field user');
</script>

<template>
  <main class="profile" aria-labelledby="profile-title">
    <header class="profile__header">
      <p class="profile__eyebrow">Account</p>
      <h1 id="profile-title">Profile</h1>
    </header>

    <Card class="profile__identity-card">
      <template #content>
        <div class="profile__identity">
          <span class="profile__avatar" aria-hidden="true"><i class="pi pi-user" /></span>
          <div>
            <h2>{{ identityLabel }}</h2>
            <p>{{ session?.userId ?? 'Session unavailable' }}</p>
          </div>
          <Tag :value="session?.branch ?? 'Branch unavailable'" severity="info" />
        </div>
      </template>
    </Card>

    <Message v-if="errorMessage" severity="warn" :closable="false">{{ errorMessage }}</Message>

    <section class="profile__section" aria-labelledby="certifications-title">
      <h2 id="certifications-title">Certifications</h2>
      <div v-if="certificates.length > 0" class="profile__certifications">
        <Card v-for="certificate in certificates" :key="certificate.id" class="profile__certificate">
          <template #content>
            <div class="profile__certificate-row">
              <div>
                <strong>{{ certificate.certType }}</strong>
                <time :datetime="certificate.expiresAt">Expires {{ formatDate(certificate.expiresAt) }}</time>
              </div>
              <Tag v-if="isExpired(certificate)" value="Expired" severity="danger" />
              <Tag v-else-if="isExpiringSoon(certificate)" value="Expiring soon" severity="warn" />
              <Tag v-else value="Current" severity="success" />
            </div>
          </template>
        </Card>
      </div>
      <p v-else class="profile__empty">No technician certifications recorded.</p>
    </section>

    <section class="profile__section" aria-labelledby="account-title">
      <h2 id="account-title">Account</h2>
      <div class="profile__account-list">
        <div class="profile__account-item"><i class="pi pi-lock" aria-hidden="true" /><span>Password &amp; security</span><Tag value="Coming soon" /></div>
        <label class="profile__account-item"><i class="pi pi-shield" aria-hidden="true" /><span>Biometric unlock</span><input v-model="biometricEnabled" type="checkbox" @change="setBiometricPreference(biometricEnabled)" /></label>
        <div class="profile__account-item"><i class="pi pi-bell" aria-hidden="true" /><span>Notifications</span><Tag value="Coming soon" /></div>
        <div class="profile__account-item"><i class="pi pi-cloud-upload" aria-hidden="true" /><span>Sync &amp; storage</span><strong>{{ pendingCount }} queued</strong></div>
        <div class="profile__account-item"><i class="pi pi-info-circle" aria-hidden="true" /><span>About</span><strong>v{{ APP_VERSION }}</strong></div>
      </div>
    </section>

    <Button class="profile__sign-out" label="Sign out" icon="pi pi-sign-out" severity="secondary" @click="signOut" />
  </main>
</template>

<style scoped>
.profile {
  display: grid;
  gap: var(--sp-4);
  min-height: 100%;
  padding: var(--sp-4);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-ui);
}

.profile__header h1,
.profile__section h2,
.profile__identity h2 { margin: 0; }
.profile__header h1 { font-size: var(--fs-h1); }
.profile__eyebrow { margin: 0 0 var(--sp-1); color: var(--color-text-muted); font-weight: var(--fw-semibold); }
.profile__identity { display: flex; align-items: center; gap: var(--sp-3); }
.profile__identity > div { min-width: 0; flex: 1; }
.profile__identity h2 { font-size: var(--fs-body-lg); }
.profile__identity p { margin: var(--sp-1) 0 0; overflow-wrap: anywhere; color: var(--color-text-muted); font-size: var(--fs-body-sm); }
.profile__avatar { width: var(--tap-field); height: var(--tap-field); display: grid; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--color-brand); color: var(--color-surface); font-size: var(--fs-h3); }
.profile__section { display: grid; gap: var(--sp-3); }
.profile__section h2 { font-size: var(--fs-h3); }
.profile__certifications, .profile__account-list { display: grid; gap: var(--tap-gap); }
.profile__certificate-row, .profile__account-item { display: flex; align-items: center; gap: var(--sp-3); }
.profile__certificate-row > div { display: grid; flex: 1; gap: var(--sp-1); }
.profile__certificate-row time { color: var(--color-text-muted); font-size: var(--fs-body-sm); }
.profile__account-item { min-height: var(--tap-min); padding: var(--sp-2) 0; border-bottom: var(--border-1); }
.profile__account-item > span { flex: 1; }
.profile__account-item input { width: var(--sp-8); height: var(--sp-8); accent-color: var(--color-field-action); }
.profile__empty { margin: 0; color: var(--color-text-muted); }
.profile__sign-out { min-height: var(--tap-min); width: 100%; }
</style>