<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { defineStore } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import MobileBackLink from '@/components/MobileBackLink.vue';
import { authenticatedFetch, currentSessionSnapshot } from '@/composables/useAuth';
import { apiBase } from '@/composables/useOfflineExecution';

type DocumentOwnerType = 'JOB';
type CertificateOwnerType = 'TECHNICIAN' | 'VESSEL';
type ResourceSource = 'cache' | 'live';

interface JobOrderDetail {
  id: string;
  vesselId?: string | null;
}

interface JoCacheRow {
  id: string;
  vessel_id?: string | null;
  vesselId?: string | null;
}

interface JobDocument {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  filename: string;
  mimeType: string;
  s3Key: string;
  uploadedById?: string | null;
  createdAt?: string | null;
  localPath?: string | null;
}

interface CachedDocumentRow {
  id: string;
  owner_type: DocumentOwnerType;
  owner_id: string;
  filename: string | null;
  mime_type: string | null;
  s3_key: string | null;
  local_path: string | null;
  pulled_at: string | null;
  uploaded_by_id?: string | null;
  created_at?: string | null;
}

interface CertificateRow {
  id: string;
  ownerType: CertificateOwnerType;
  ownerId: string;
  certType: string;
  expiresAt: string;
}

interface CachedCertificateRow {
  id: string;
  owner_type: CertificateOwnerType;
  owner_id: string;
  cert_type: string;
  expires_at: string;
}

interface MobileSqlAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface OpenFileInput {
  path?: string;
  s3Key?: string;
  filename: string;
  mimeType: string;
}

interface MobileRuntime {
  marinex360?: {
    db?: MobileSqlAdapter;
    files?: {
      openCachedFile?(input: OpenFileInput): Promise<void>;
      fetchByS3Key?(input: OpenFileInput): Promise<void>;
    };
  };
}

class MobileApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function mobileRuntime(): MobileRuntime {
  return globalThis as typeof globalThis & MobileRuntime;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function currentUserId(): string | null {
  return currentSessionSnapshot()?.userId ?? null;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(`${apiBase()}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) throw new MobileApiError(response.status, 'Request failed.');

  return (await response.json()) as T;
}

function queryPath(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

function db(): MobileSqlAdapter | null {
  return mobileRuntime().marinex360?.db ?? null;
}

async function loadCachedJob(jobOrderId: string): Promise<JoCacheRow | null> {
  const adapter = db();
  if (!adapter) return null;

  const rows = await adapter.select<JoCacheRow>('SELECT * FROM jo_cache WHERE id=?', [jobOrderId]);
  return rows[0] ?? null;
}

async function loadLiveJob(jobOrderId: string): Promise<JobOrderDetail> {
  return getJson<JobOrderDetail>(`/job-orders/${encodeURIComponent(jobOrderId)}`);
}

async function assignedJobContext(jobOrderId: string): Promise<{ vesselId: string | null; liveConfirmed: boolean }> {
  const cachedJob = await loadCachedJob(jobOrderId);

  if (isOnline()) {
    try {
      const liveJob = await loadLiveJob(jobOrderId);
      return {
        vesselId: liveJob.vesselId ?? cachedJob?.vessel_id ?? cachedJob?.vesselId ?? null,
        liveConfirmed: true,
      };
    } catch (error) {
      if (error instanceof MobileApiError && [403, 404].includes(error.status)) {
        throw new Error('Job order is not assigned to this device.');
      }
    }
  }

  if (!cachedJob) throw new Error('Job order is not available offline.');

  return {
    // NEEDS: Mobile jo_cache currently lacks vesselId, so vessel certificates need a live job detail or a cache schema addition.
    vesselId: cachedJob.vessel_id ?? cachedJob.vesselId ?? null,
    liveConfirmed: false,
  };
}

function fromCachedDocument(row: CachedDocumentRow): JobDocument {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    filename: row.filename ?? 'Document',
    mimeType: row.mime_type ?? 'application/octet-stream',
    s3Key: row.s3_key ?? '',
    uploadedById: row.uploaded_by_id ?? null,
    createdAt: row.created_at ?? row.pulled_at,
    localPath: row.local_path,
  };
}

async function loadCachedDocuments(jobOrderId: string): Promise<JobDocument[]> {
  const adapter = db();
  if (!adapter) return [];

  const rows = await adapter.select<CachedDocumentRow>(
    `SELECT *
     FROM document_cache
     WHERE owner_type='JOB' AND owner_id=?
     ORDER BY pulled_at DESC, filename ASC`,
    [jobOrderId],
  );

  return rows.map(fromCachedDocument);
}

async function loadLiveDocuments(jobOrderId: string): Promise<JobDocument[]> {
  return getJson<JobDocument[]>(queryPath('/documents', {
    ownerType: 'JOB',
    ownerId: jobOrderId,
  }));
}

function mergeCachedPaths(liveDocuments: JobDocument[], cachedDocuments: JobDocument[]): JobDocument[] {
  const cacheById = new Map(cachedDocuments.map((document) => [document.id, document]));
  const cacheByS3Key = new Map(cachedDocuments.map((document) => [document.s3Key, document]));

  return liveDocuments.map((document) => {
    const cached = cacheById.get(document.id) ?? cacheByS3Key.get(document.s3Key);
    return {
      ...document,
      localPath: cached?.localPath ?? document.localPath ?? null,
    };
  });
}

function fromCachedCertificate(row: CachedCertificateRow): CertificateRow {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    certType: row.cert_type,
    expiresAt: row.expires_at,
  };
}

async function loadCachedCertificates(userId: string | null, vesselId: string | null): Promise<CertificateRow[]> {
  const adapter = db();
  if (!adapter) return [];

  const clauses: string[] = [];
  const params: string[] = [];

  if (userId) {
    clauses.push("(owner_type='TECHNICIAN' AND owner_id=?)");
    params.push(userId);
  }

  if (vesselId) {
    clauses.push("(owner_type='VESSEL' AND owner_id=?)");
    params.push(vesselId);
  }

  if (clauses.length === 0) return [];

  try {
    const rows = await adapter.select<CachedCertificateRow>(
      `SELECT *
       FROM certificate_cache
       WHERE ${clauses.join(' OR ')}
       ORDER BY expires_at ASC`,
      params,
    );
    return rows.map(fromCachedCertificate);
  } catch {
    // NEEDS: Mobile prefetch schema currently has document_cache but no certificate_cache.
    return [];
  }
}

async function loadLiveCertificates(userId: string | null, vesselId: string | null): Promise<CertificateRow[]> {
  const requests: Promise<CertificateRow[]>[] = [];

  if (userId) {
    requests.push(getJson<CertificateRow[]>(queryPath('/certificates', {
      ownerType: 'TECHNICIAN',
      ownerId: userId,
    })));
  }

  if (vesselId) {
    requests.push(getJson<CertificateRow[]>(queryPath('/certificates', {
      ownerType: 'VESSEL',
      ownerId: vesselId,
    })));
  }

  return (await Promise.all(requests)).flat();
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded';

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function isExpired(certificate: CertificateRow): boolean {
  return new Date(certificate.expiresAt).getTime() < Date.now();
}

const useJobDocumentsStore = defineStore('jobDocuments', () => {
  const documents = ref<JobDocument[]>([]);
  const certificates = ref<CertificateRow[]>([]);
  const source = ref<ResourceSource | null>(null);
  const isLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  const openErrorMessage = ref<string | null>(null);

  const sortedDocuments = computed(() => [...documents.value]);
  const sortedCertificates = computed(() => [...certificates.value]);

  async function load(jobOrderId: string): Promise<void> {
    isLoading.value = true;
    errorMessage.value = null;
    openErrorMessage.value = null;

    try {
      const context = await assignedJobContext(jobOrderId);
      const userId = currentUserId();
      const cachedDocuments = await loadCachedDocuments(jobOrderId);
      const cachedCertificates = await loadCachedCertificates(userId, context.vesselId);

      if (isOnline() && context.liveConfirmed) {
        try {
          documents.value = mergeCachedPaths(await loadLiveDocuments(jobOrderId), cachedDocuments);
          certificates.value = await loadLiveCertificates(userId, context.vesselId);
          source.value = 'live';
          return;
        } catch (error) {
          if (cachedDocuments.length === 0 && cachedCertificates.length === 0) throw error;
        }
      }

      documents.value = cachedDocuments;
      certificates.value = cachedCertificates;
      source.value = 'cache';
    } catch (error) {
      documents.value = [];
      certificates.value = [];
      source.value = null;
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load documents.';
    } finally {
      isLoading.value = false;
    }
  }

  async function openDocument(document: JobDocument): Promise<void> {
    openErrorMessage.value = null;
    const files = mobileRuntime().marinex360?.files;

    try {
      if (document.localPath) {
        if (!files?.openCachedFile) throw new Error('Cached file opener is not available.');
        await files.openCachedFile({
          path: document.localPath,
          filename: document.filename,
          mimeType: document.mimeType,
        });
        return;
      }

      if (!isOnline()) throw new Error('Document is not cached on this device.');
      if (!files?.fetchByS3Key) {
        // NEEDS: Mobile storage adapter must resolve an authorized S3 key for read-only document open/download.
        throw new Error('Document download is not available on this device.');
      }

      await files.fetchByS3Key({
        s3Key: document.s3Key,
        filename: document.filename,
        mimeType: document.mimeType,
      });
    } catch (error) {
      openErrorMessage.value = error instanceof Error ? error.message : 'Unable to open document.';
    }
  }

  return {
    documents,
    certificates,
    sortedDocuments,
    sortedCertificates,
    source,
    isLoading,
    errorMessage,
    openErrorMessage,
    load,
    openDocument,
  };
});

const props = defineProps<{
  jobOrderId?: string;
}>();

const route = useRoute();
const jobDocumentsStore = useJobDocumentsStore();

const resolvedJobOrderId = computed(() => {
  const routeId = route.params.id ?? route.params.jobOrderId;
  if (props.jobOrderId) return props.jobOrderId;
  return Array.isArray(routeId) ? routeId[0] : routeId;
});

async function loadCurrentJobDocuments(): Promise<void> {
  const jobOrderId = resolvedJobOrderId.value?.trim();
  if (!jobOrderId) {
    jobDocumentsStore.errorMessage = 'Job order is required.';
    return;
  }

  await jobDocumentsStore.load(jobOrderId);
}

function handleOnlineStatusChange(): void {
  void loadCurrentJobDocuments();
}

onMounted(() => {
  void loadCurrentJobDocuments();

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnlineStatusChange);
    window.addEventListener('offline', handleOnlineStatusChange);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnlineStatusChange);
    window.removeEventListener('offline', handleOnlineStatusChange);
  }
});
</script>

<template>
  <main class="job-documents" aria-labelledby="job-documents-title">
    <header class="job-documents__header">
      <div>
        <MobileBackLink :to="`/jobs/${jobOrderId}`" label="Return" />
        <p class="job-documents__eyebrow">Job files</p>
        <h1 id="job-documents-title" class="job-documents__title">Documents</h1>
      </div>

      <Button
        class="job-documents__refresh"
        icon="pi pi-refresh"
        aria-label="Refresh documents"
        rounded
        severity="secondary"
        :loading="jobDocumentsStore.isLoading"
        @click="loadCurrentJobDocuments"
      />
    </header>

    <Message v-if="jobDocumentsStore.source === 'cache'" severity="info" :closable="false">
      Showing saved files.
    </Message>

    <Message v-if="jobDocumentsStore.errorMessage" severity="error" :closable="false">
      {{ jobDocumentsStore.errorMessage }}
    </Message>

    <Message v-if="jobDocumentsStore.openErrorMessage" severity="error" :closable="false">
      {{ jobDocumentsStore.openErrorMessage }}
    </Message>

    <div v-if="jobDocumentsStore.isLoading" class="job-documents__loading" aria-live="polite">
      <ProgressSpinner class="job-documents__spinner" stroke-width="4" />
    </div>

    <template v-else>
      <section class="job-documents__section" aria-labelledby="job-files-title">
        <h2 id="job-files-title" class="job-documents__section-title">Job documents</h2>

        <div v-if="jobDocumentsStore.sortedDocuments.length > 0" class="job-documents__list">
          <Card v-for="document in jobDocumentsStore.sortedDocuments" :key="document.id" class="job-documents__card">
            <template #content>
              <button type="button" class="job-documents__row" @click="jobDocumentsStore.openDocument(document)">
                <span class="job-documents__row-main">
                  <span class="job-documents__name">{{ document.filename }}</span>
                  <span class="job-documents__meta">{{ document.mimeType }}</span>
                  <span class="job-documents__meta">Uploaded by {{ document.uploadedById || 'unknown' }}</span>
                </span>
                <span class="job-documents__row-side">
                  <time :datetime="document.createdAt ?? undefined">{{ formatDate(document.createdAt) }}</time>
                  <Tag v-if="document.localPath" value="Cached" severity="success" />
                </span>
              </button>
            </template>
          </Card>
        </div>

        <p v-else class="job-documents__empty">No job documents.</p>
      </section>

      <section class="job-documents__section" aria-labelledby="certificates-title">
        <h2 id="certificates-title" class="job-documents__section-title">Certificates</h2>

        <div v-if="jobDocumentsStore.sortedCertificates.length > 0" class="job-documents__list">
          <Card
            v-for="certificate in jobDocumentsStore.sortedCertificates"
            :key="certificate.id"
            class="job-documents__card"
            :class="{ 'job-documents__card--expired': isExpired(certificate) }"
          >
            <template #content>
              <article class="job-documents__certificate">
                <span class="job-documents__row-main">
                  <span class="job-documents__name">{{ certificate.certType }}</span>
                  <span class="job-documents__meta">{{ certificate.ownerType }}</span>
                </span>
                <span class="job-documents__row-side">
                  <time :datetime="certificate.expiresAt">{{ formatDate(certificate.expiresAt) }}</time>
                  <Tag v-if="isExpired(certificate)" value="Expired" severity="danger" />
                </span>
              </article>
            </template>
          </Card>
        </div>

        <p v-else class="job-documents__empty">No certificates.</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.job-documents {
  min-height: 100%;
  padding: var(--sp-4);
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-ui);
}

.job-documents__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-4);
}

.job-documents__eyebrow {
  margin: 0 0 var(--sp-1);
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.job-documents__title {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.job-documents__refresh {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
}

.job-documents__loading {
  display: grid;
  min-height: var(--tap-field);
  place-items: center;
  padding: var(--sp-8);
}

.job-documents__spinner {
  width: var(--tap-min);
  height: var(--tap-min);
}

.job-documents__section {
  display: grid;
  gap: var(--sp-3);
  margin-top: var(--sp-5);
}

.job-documents__section-title {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.job-documents__list {
  display: grid;
  gap: var(--tap-gap);
}

.job-documents__card {
  overflow: hidden;
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.job-documents__card--expired {
  border-color: var(--status-error-br);
  background: var(--status-error-bg);
}

.job-documents__row,
.job-documents__certificate {
  display: flex;
  width: 100%;
  min-height: var(--tap-field);
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.job-documents__row {
  cursor: pointer;
}

.job-documents__row:focus-visible {
  outline: var(--border-2);
  outline-offset: var(--sp-1);
}

.job-documents__row-main,
.job-documents__row-side {
  display: grid;
  gap: var(--sp-1);
}

.job-documents__row-main {
  min-width: 0;
}

.job-documents__row-side {
  flex: 0 0 auto;
  justify-items: end;
  max-width: 45%;
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
  text-align: right;
}

.job-documents__name {
  overflow-wrap: anywhere;
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-base);
}

.job-documents__meta,
.job-documents__empty {
  color: var(--color-text-muted);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-base);
}

.job-documents__empty {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  border: var(--border-1);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

@media (min-width: 720px) {
  .job-documents {
    padding: var(--sp-6);
  }

  .job-documents__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
