import { afterEach, describe, expect, it } from 'vitest';
import { loadExecutionSummary } from '../src/composables/useExecutionSummary';

interface RuntimeWithDb {
  marinex360?: {
    db?: {
      select<T>(sql: string, params?: unknown[]): Promise<T[]>;
    };
  };
}

const runtime = globalThis as typeof globalThis & RuntimeWithDb;

afterEach(() => {
  delete runtime.marinex360;
});

describe('loadExecutionSummary', () => {
  it('reflects captured checklist, material, photo, observation, and signature data', async () => {
    runtime.marinex360 = {
      db: {
        async select<T>(sql: string): Promise<T[]> {
          if (sql.includes('FROM checklist_instance')) {
            return [{
              id: 'checklist-1',
              template_id: 'template-1',
              results_json: JSON.stringify([{ itemId: 'visual', value: true }]),
              completed_at: '2026-09-05T01:00:00.000Z',
              sync_state: 'PENDING',
            }] as T[];
          }
          if (sql.includes('FROM material_line')) {
            return [{
              id: 'material-1',
              description: 'Gasket kit',
              quantity: '1',
              unit: 'set',
              unit_cost_amount_minor: 5000,
              unit_cost_currency: 'SGD',
              sync_state: 'PENDING',
            }] as T[];
          }
          if (sql.includes('FROM observation')) {
            return [{
              id: 'observation-1',
              body: 'Pump inspected.',
              created_at: '2026-09-05T01:05:00.000Z',
              sync_state: 'PENDING',
            }] as T[];
          }
          if (sql.includes('FROM photo')) {
            return [{
              id: 'photo-1',
              phase: 'DURING',
              local_path: 'photos/photo-1.jpg',
              s3_key: null,
              taken_at: '2026-09-05T01:10:00.000Z',
              sync_state: 'PENDING',
            }] as T[];
          }
          if (sql.includes('FROM esignature')) {
            return [{
              id: 'signature-1',
              signer_name: 'Tariq Technician',
              signer_role: 'Technician',
              signed_at: '2026-09-05T01:15:00.000Z',
              document_hash: 'a'.repeat(64),
              sync_state: 'PENDING',
            }] as T[];
          }
          return [];
        },
      },
    };

    const summary = await loadExecutionSummary('job-1');

    expect(summary.checklists[0]).toMatchObject({
      id: 'checklist-1',
      templateId: 'template-1',
      results: [{ itemId: 'visual', value: true }],
    });
    expect(summary.materials[0]).toMatchObject({ description: 'Gasket kit', quantity: '1', unit: 'set' });
    expect(summary.observations[0]).toMatchObject({ body: 'Pump inspected.' });
    expect(summary.photos[0]).toMatchObject({ phase: 'DURING', localPath: 'photos/photo-1.jpg' });
    expect(summary.signatures[0]).toMatchObject({ signerName: 'Tariq Technician', documentHash: 'a'.repeat(64) });
  });
});
