import { describe, expect, it } from 'vitest';
import { resolveOwnerBranch } from '../src/services/branchScope.js';

describe('resolveOwnerBranch', () => {
  it('resolves CLIENT directly from Client.branch', async () => {
    const prisma = {
      client: { findFirst: async () => ({ branch: 'SG' }) },
    } as any;

    await expect(resolveOwnerBranch(prisma, 'CLIENT', 'client-1')).resolves.toBe('SG');
  });

  it('resolves VESSEL through its owning Client.branch', async () => {
    const prisma = {
      vessel: { findFirst: async () => ({ client: { branch: 'MY', deletedAt: null } }) },
    } as any;

    await expect(resolveOwnerBranch(prisma, 'VESSEL', 'vessel-1')).resolves.toBe('MY');
  });

  it('hides a VESSEL whose owning Client is soft-deleted', async () => {
    const prisma = {
      vessel: { findFirst: async () => ({ client: { branch: 'MY', deletedAt: new Date() } }) },
    } as any;

    await expect(resolveOwnerBranch(prisma, 'VESSEL', 'vessel-1')).resolves.toBeNull();
  });

  it('resolves JOB directly from JobOrder.branch', async () => {
    const prisma = {
      jobOrder: { findFirst: async () => ({ branch: 'ID' }) },
    } as any;

    await expect(resolveOwnerBranch(prisma, 'JOB', 'job-1')).resolves.toBe('ID');
  });

  it('resolves TECHNICIAN certificates through User.branch (D-043)', async () => {
    const prisma = {
      user: { findFirst: async () => ({ branch: 'BD' }) },
    } as any;

    await expect(resolveOwnerBranch(prisma, 'TECHNICIAN', 'user-1')).resolves.toBe('BD');
  });

  it('leaves COMPANY certificates unscoped (D-043)', async () => {
    await expect(resolveOwnerBranch({} as any, 'COMPANY', 'tkmr')).resolves.toBeNull();
  });
});
