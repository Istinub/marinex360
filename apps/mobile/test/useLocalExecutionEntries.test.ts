import { afterEach, describe, expect, it } from 'vitest';
import {
  listLocalObservations,
  observationTemplateKey,
  updateLocalMaterial,
  type LocalMaterialEntry,
} from '../src/composables/useLocalExecutionEntries';

interface RuntimeWithDb {
  marinex360?: {
    db?: {
      select<T>(sql: string, params?: unknown[]): Promise<T[]>;
      execute(sql: string, params?: unknown[]): Promise<void>;
      transaction?<T>(work: () => Promise<T>): Promise<T>;
    };
  };
}

const runtime = globalThis as typeof globalThis & RuntimeWithDb;

afterEach(() => {
  delete runtime.marinex360;
});

describe('local execution entries', () => {
  it('lists observation photo counts from the local observation marker', async () => {
    runtime.marinex360 = {
      db: {
        async select<T>(): Promise<T[]> {
          return [{
            id: 'observation-1',
            body: 'Main engine bearing inspected with no abnormal vibration.',
            template_key: observationTemplateKey(['photo-op-1', 'photo-op-2']),
            created_at: '2026-09-05T00:00:00.000Z',
            sync_state: 'PENDING',
          }] as T[];
        },
        async execute(): Promise<void> {},
      },
    };

    const rows = await listLocalObservations('job-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.photoOpIds).toEqual(['photo-op-1', 'photo-op-2']);
  });

  it('updates a material row and queues an UPDATE op', async () => {
    const executed: { sql: string; params: unknown[] }[] = [];
    runtime.marinex360 = {
      db: {
        async select<T>(sql: string): Promise<T[]> {
          if (sql.includes('app_meta')) return [{ v: '1' }] as T[];
          return [] as T[];
        },
        async execute(sql: string, params: unknown[] = []): Promise<void> {
          executed.push({ sql, params });
        },
        async transaction<T>(work: () => Promise<T>): Promise<T> {
          return work();
        },
      },
    };
    const entry: LocalMaterialEntry = {
      id: 'material-1',
      description: 'Old gasket',
      quantity: '1',
      unit: 'set',
      unitCostAmountMinor: 1000,
      unitCostCurrency: 'SGD',
      syncState: 'PENDING',
      version: 3,
    };

    await updateLocalMaterial(entry, 'job-1', {
      description: 'New gasket',
      quantity: '2',
      unit: 'set',
      unitCostAmountMinor: 1200,
      unitCostCurrency: 'SGD',
    });

    expect(executed.some((call) => call.sql.includes('UPDATE material_line'))).toBe(true);
    const queued = executed.find((call) => call.sql.includes('INSERT INTO op_queue'));
    expect(queued?.params[1]).toBe('MaterialLine');
    expect(queued?.params[3]).toBe('job-1');
    expect(queued?.params[5]).toBe(3);
  });
});
