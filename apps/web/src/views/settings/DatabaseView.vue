<script setup lang="ts">
import Button from 'primevue/button';
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { get, post } from '@/lib/api/client';
import { ApiResponseError } from '@/lib/api/errors';

interface DevTable {
  table_name: string;
  approx_row_count: string | number;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

const tables = ref<DevTable[]>([]);
const selectedTable = ref<string | null>(null);
const tableRows = ref<Record<string, unknown>[]>([]);
const querySql = ref('SELECT * FROM "JobOrder" LIMIT 20');
const queryRows = ref<Record<string, unknown>[]>([]);
const queryRowCount = ref<number | null>(null);
const isLoadingTables = ref(false);
const isLoadingRows = ref(false);
const isRunningQuery = ref(false);
const errorMessage = ref<string | null>(null);
const disabledMessage = ref<string | null>(null);
const queryError = ref<string | null>(null);

const tableColumns = computed(() => columnsFor(tableRows.value));
const queryColumns = computed(() => columnsFor(queryRows.value));

function columnsFor(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  rows.slice(0, 20).forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
  return Array.from(keys);
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function applyError(error: unknown, fallback: string): void {
  if (error instanceof ApiResponseError) {
    if (error.status === 403 && /feature 'DEV_TOOLS' is not enabled/i.test(error.message)) {
      disabledMessage.value = 'Database tools are currently disabled. Enable them in Settings -> Security.';
      errorMessage.value = null;
      return;
    }
    errorMessage.value = error.message;
    return;
  }
  errorMessage.value = fallback;
}

async function loadTables(): Promise<void> {
  isLoadingTables.value = true;
  errorMessage.value = null;
  disabledMessage.value = null;
  try {
    tables.value = await get<DevTable[]>('/admin/dev/tables');
  } catch (error) {
    applyError(error, 'Unable to load database tables.');
  } finally {
    isLoadingTables.value = false;
  }
}

async function loadTable(tableName: string): Promise<void> {
  selectedTable.value = tableName;
  isLoadingRows.value = true;
  errorMessage.value = null;
  try {
    tableRows.value = await get<Record<string, unknown>[]>(`/admin/dev/tables/${encodeURIComponent(tableName)}?page=1&pageSize=50`);
  } catch (error) {
    applyError(error, `Unable to load ${tableName}.`);
  } finally {
    isLoadingRows.value = false;
  }
}

async function runQuery(): Promise<void> {
  isRunningQuery.value = true;
  queryError.value = null;
  queryRowCount.value = null;
  try {
    const result = await post<QueryResult, { sql: string }>('/admin/dev/query', { sql: querySql.value });
    queryRows.value = result.rows;
    queryRowCount.value = result.rowCount;
  } catch (error) {
    queryRows.value = [];
    queryError.value = error instanceof ApiResponseError ? error.message : 'Query failed.';
  } finally {
    isRunningQuery.value = false;
  }
}

onMounted(loadTables);
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="database-title">
    <div class="record-form-card database-card">
      <header class="crm-page__header">
        <div>
          <p class="crm-page__eyebrow">Settings</p>
          <h1 id="database-title" class="crm-page__title">Database</h1>
          <p class="record-form__version">Read-only table browser and SELECT-only diagnostic query console.</p>
        </div>
      </header>

      <p v-if="disabledMessage" class="auth-message auth-message--error" role="alert">
        {{ disabledMessage }}
        <RouterLink to="/settings/security">Open Security settings</RouterLink>
      </p>
      <p v-else-if="errorMessage" class="auth-message auth-message--error" role="alert">{{ errorMessage }}</p>

      <section class="database-section" aria-labelledby="database-tables-title">
        <div class="database-section__header">
          <div>
            <h2 id="database-tables-title">Tables</h2>
            <p>Browse rows through the read-only database role.</p>
          </div>
          <Button label="Refresh" icon="pi pi-refresh" severity="secondary" :loading="isLoadingTables" @click="loadTables" />
        </div>

        <p v-if="isLoadingTables" class="crm-empty">Loading tables...</p>
        <div v-else class="database-table-wrap">
          <table class="database-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Approx rows</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in tables" :key="table.table_name">
                <td class="database-table__mono">{{ table.table_name }}</td>
                <td>{{ table.approx_row_count }}</td>
                <td>
                  <Button label="Browse" icon="pi pi-table" severity="secondary" size="small" @click="loadTable(table.table_name)" />
                </td>
              </tr>
              <tr v-if="tables.length === 0 && !disabledMessage">
                <td colspan="3">No tables returned.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="selectedTable" class="database-section" aria-labelledby="database-rows-title">
        <div class="database-section__header">
          <div>
            <h2 id="database-rows-title">{{ selectedTable }}</h2>
            <p>First 50 rows.</p>
          </div>
        </div>
        <p v-if="isLoadingRows" class="crm-empty">Loading rows...</p>
        <div v-else class="database-table-wrap database-table-wrap--wide">
          <table class="database-table">
            <thead>
              <tr>
                <th v-for="column in tableColumns" :key="column">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in tableRows" :key="rowIndex">
                <td v-for="column in tableColumns" :key="column">{{ formatCell(row[column]) }}</td>
              </tr>
              <tr v-if="tableRows.length === 0">
                <td :colspan="Math.max(tableColumns.length, 1)">No rows returned.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="database-section" aria-labelledby="database-query-title">
        <div class="database-section__header">
          <div>
            <h2 id="database-query-title">Query</h2>
            <p>SELECT statements only. Results are automatically limited by the API.</p>
          </div>
        </div>
        <textarea v-model="querySql" class="database-query-input" rows="5" spellcheck="false" />
        <p v-if="queryError" class="auth-message auth-message--error" role="alert">{{ queryError }}</p>
        <div class="record-form__actions record-form__actions--left">
          <Button label="Run query" icon="pi pi-play" :loading="isRunningQuery" @click="runQuery" />
        </div>

        <p v-if="queryRowCount !== null" class="record-form__version">{{ queryRowCount }} rows returned.</p>
        <div v-if="queryRows.length > 0" class="database-table-wrap database-table-wrap--wide">
          <table class="database-table">
            <thead>
              <tr>
                <th v-for="column in queryColumns" :key="column">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in queryRows" :key="rowIndex">
                <td v-for="column in queryColumns" :key="column">{{ formatCell(row[column]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.database-card {
  max-width: 100%;
}

.database-section {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4) 0;
  border-top: 1px solid var(--color-border);
}

.database-section__header {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  align-items: flex-start;
}

.database-section h2,
.database-section p {
  margin: 0;
}

.database-section p {
  color: var(--color-text-muted);
}

.database-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.database-table-wrap--wide {
  max-height: 32rem;
}

.database-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-body-sm);
}

.database-table th,
.database-table td {
  padding: var(--sp-2);
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
}

.database-table th {
  color: var(--color-text-muted);
  font-weight: 600;
  background: #F4F7FA;
}

.database-table__mono,
.database-table td {
  font-family: var(--font-code);
}

.database-query-input {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  font-family: var(--font-code);
  color: var(--color-text);
  background: var(--color-surface);
}
</style>
