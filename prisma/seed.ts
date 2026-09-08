// Synthetic seed (S0-7). PDPA/INFRA-1: SYNTHETIC DATA ONLY — no real client or personal data.
// Fixed Phase-1 accounts, 2 clients, 2 vessels, 2 Job Orders in different states (+ status history).
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password.js';
import { SEEDED_CHECKLIST_CATEGORIES } from '../apps/api/src/domain/checklistCategories.js';

// Seed runs as the owner (DIRECT_DATABASE_URL) so it can reset append-only tables.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } },
});
const PW = 'MarineX360-dev!'; // local synthetic only
const LEGACY_SEED_USER_EMAILS = ['client@tkmr.local'];

async function main() {
  const pwHash = await hashPassword(PW);
  const mk = (email: string, name: string, roles: string[], branch: string, extra: Record<string, unknown> = {}) =>
    prisma.user.upsert({
      where: { email },
      update: { name, passwordHash: pwHash, roles, branch, ...extra },
      create: { email, name, passwordHash: pwHash, roles, branch, ...extra },
    });

  const tech = await mk('tech@tkmr.local', 'Device-1', ['TECHNICIAN'], 'SG',
    { skills: ['welding', 'hydraulics'], baseLocation: 'Jurong', available: true, designation: 'Field Technician', active: true });
  const tech2 = await mk('tech2@tkmr.local', 'Device-2', ['TECHNICIAN'], 'SG',
    { skills: ['electrical', 'inspection'], baseLocation: 'Tuas', available: true, designation: 'Field Technician', active: true });
  const tech3 = await mk('tech3@tkmr.local', 'Device-3', ['TECHNICIAN'], 'SG',
    { skills: ['mechanical', 'safety'], baseLocation: 'Keppel', available: true, designation: 'Field Technician', active: true });
  const supervisor = await mk('ops@tkmr.local', 'Operations', ['OPS_SUPERVISOR'], 'SG', { active: true });
  const finance = await mk('finance@tkmr.local', 'Finance', ['FINANCE'], 'SG', { mfaEnrolled: false, active: true });
  const director = await mk('director@tkmr.local', 'Director', ['DIRECTOR'], 'SG', { active: true });
  const admin = await mk('admin@tkmr.local', 'Admin', ['SYSTEM_ADMIN'], 'SG', { mfaEnrolled: false, active: true });

  const legacySeedUsers = await prisma.user.findMany({
    where: { email: { in: LEGACY_SEED_USER_EMAILS } },
    select: { id: true },
  });
  const legacySeedUserIds = legacySeedUsers.map((user) => user.id);
  if (legacySeedUserIds.length > 0) {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: legacySeedUserIds } } });
    await prisma.device.deleteMany({ where: { assignedUserId: { in: legacySeedUserIds } } });
    await prisma.jobStatusHistory.updateMany({ where: { actorId: { in: legacySeedUserIds } }, data: { actorId: admin.id } });
    await prisma.user.deleteMany({ where: { id: { in: legacySeedUserIds } } });
  }

  const upsertContact = async (email: string, name: string, phone: string) => {
    const existing = await prisma.contact.findFirst({ where: { email } });
    const data = { name, email, phone };
    return existing
      ? prisma.contact.update({ where: { id: existing.id }, data })
      : prisma.contact.create({ data });
  };
  const upsertClient = async (name: string, data: { branch: string; address: string; creditTerms: string; primaryContactId: string }) => {
    const existing = await prisma.client.findFirst({ where: { branch: data.branch, name, deletedAt: null } });
    return existing
      ? prisma.client.update({ where: { id: existing.id }, data: { ...data, name } })
      : prisma.client.create({ data: { ...data, name } });
  };

  const contactA = await upsertContact('ops@pacificlines.example', 'Operations Desk (Pacific Lines)', '+65-6000-0001');
  const contactB = await upsertContact('fleet@straitsbulk.example', 'Fleet Manager (Straits Bulk)', '+65-6000-0002');

  const clientA = await upsertClient('Pacific Lines Pte Ltd', { branch: 'SG', address: '1 Maritime Sq, Singapore', creditTerms: 'NET30', primaryContactId: contactA.id });
  const clientB = await upsertClient('Straits Bulk Carriers', { branch: 'SG', address: '9 Keppel Rd, Singapore', creditTerms: 'NET45', primaryContactId: contactB.id });
  const vesselA = await prisma.vessel.upsert({
    where: { imoNumber: '9251986' },
    update: { clientId: clientA.id, name: 'MV Pacific Dawn', type: 'Bulk Carrier', flag: 'SG', classification: 'ABS', deletedAt: null },
    create: { clientId: clientA.id, imoNumber: '9251986', name: 'MV Pacific Dawn', type: 'Bulk Carrier', flag: 'SG', classification: 'ABS' },
  });
  const vesselB = await prisma.vessel.upsert({
    where: { imoNumber: '9411406' },
    update: { clientId: clientB.id, name: 'MV Straits Pioneer', type: 'Tanker', flag: 'SG', classification: 'DNV', deletedAt: null },
    create: { clientId: clientB.id, imoNumber: '9411406', name: 'MV Straits Pioneer', type: 'Tanker', flag: 'SG', classification: 'DNV' },
  });

  // JO #1 — DRAFT
  await prisma.jobOrder.upsert({
    where: { joNumber: 'SG-2026-0001' },
    update: {
      branch: 'SG', clientId: clientA.id, vesselId: vesselA.id,
      serviceCategories: ['mechanical'], port: 'Singapore', scopeSummary: 'Main engine cooling pump overhaul',
      origin: 'MANUAL', externalQuoteRef: 'EXT-Q-5521', quotedAmountMinor: 4500000, quotedCurrency: 'SGD',
      labourRateAmountMinor: 9000, labourRateCurrency: 'SGD', state: 'DRAFT', createdBy: supervisor.id,
      assignedTechnicianIds: [], executionOwnerId: null, deletedAt: null, archivedAt: null, purgedAt: null,
    },
    create: {
      joNumber: 'SG-2026-0001', branch: 'SG', clientId: clientA.id, vesselId: vesselA.id,
      serviceCategories: ['mechanical'], port: 'Singapore', scopeSummary: 'Main engine cooling pump overhaul',
      origin: 'MANUAL', externalQuoteRef: 'EXT-Q-5521', quotedAmountMinor: 4500000, quotedCurrency: 'SGD',
      labourRateAmountMinor: 9000, labourRateCurrency: 'SGD', state: 'DRAFT', createdBy: supervisor.id,
    },
  });

  // JO #2 — IN_PROGRESS, owned by the technician, with realistic status history.
  const jo2 = await prisma.jobOrder.upsert({
    where: { joNumber: 'SG-2026-0002' },
    update: {
      branch: 'SG', clientId: clientB.id, vesselId: vesselB.id,
      serviceCategories: ['electrical', 'inspection'], port: 'Singapore', scopeSummary: 'Switchboard thermal survey + breaker service',
      origin: 'MANUAL', quotedAmountMinor: 2800000, quotedCurrency: 'SGD',
      labourRateAmountMinor: 9000, labourRateCurrency: 'SGD', state: 'IN_PROGRESS',
      assignedTechnicianIds: [tech.id], executionOwnerId: tech.id, createdBy: supervisor.id,
      deletedAt: null, archivedAt: null, purgedAt: null,
    },
    create: {
      joNumber: 'SG-2026-0002', branch: 'SG', clientId: clientB.id, vesselId: vesselB.id,
      serviceCategories: ['electrical', 'inspection'], port: 'Singapore', scopeSummary: 'Switchboard thermal survey + breaker service',
      origin: 'MANUAL', quotedAmountMinor: 2800000, quotedCurrency: 'SGD',
      labourRateAmountMinor: 9000, labourRateCurrency: 'SGD', state: 'IN_PROGRESS',
      assignedTechnicianIds: [tech.id], executionOwnerId: tech.id, createdBy: supervisor.id,
    },
  });
  await prisma.jobStatusHistory.deleteMany({ where: { jobOrderId: jo2.id } });
  await prisma.jobStatusHistory.createMany({
    data: [
      { jobOrderId: jo2.id, fromState: 'DRAFT', toState: 'SCHEDULED', actorId: supervisor.id },
      { jobOrderId: jo2.id, fromState: 'SCHEDULED', toState: 'IN_PROGRESS', actorId: tech.id },
    ],
  });

  const devices = [
    { id: 'Device-1', name: 'Device-1', pin: '0000', assignedUserId: tech.id, branch: tech.branch },
    { id: 'Device-2', name: 'Device-2', pin: '0002', assignedUserId: tech2.id, branch: tech2.branch },
    { id: 'Device-3', name: 'Device-3', pin: '0003', assignedUserId: tech3.id, branch: tech3.branch },
    { id: 'Device-Admin', name: 'Device-Admin', pin: '1111', assignedUserId: admin.id, branch: admin.branch },
    { id: 'Device-Director', name: 'Device-Director', pin: '1234', assignedUserId: director.id, branch: director.branch },
  ];
  for (const device of devices) {
    await prisma.device.upsert({
      where: { id: device.id },
      update: {
        name: device.name,
        pin: await hashPassword(device.pin),
        assignedUserId: device.assignedUserId,
        branch: device.branch,
      },
      create: {
        id: device.id,
        name: device.name,
        pin: await hashPassword(device.pin),
        assignedUserId: device.assignedUserId,
        branch: device.branch,
      },
    });
  }

  for (const category of SEEDED_CHECKLIST_CATEGORIES) {
    await prisma.checklistCategory.upsert({
      where: { id: category.id },
      update: { name: category.name, sortOrder: category.sortOrder },
      create: { id: category.id, name: category.name, sortOrder: category.sortOrder },
    });
    for (const item of category.items) {
      await prisma.checklistTemplateItem.upsert({
        where: { id: item.id },
        update: { categoryId: category.id, label: item.label, sortOrder: item.sortOrder },
        create: { id: item.id, categoryId: category.id, label: item.label, sortOrder: item.sortOrder },
      });
    }
    await prisma.checklistTemplate.upsert({
      where: { id: `fixed-${category.id}` },
      update: {
        name: `${category.name} checklist`,
        categoryId: category.id,
        serviceCategory: category.id,
        items: category.items.map((item) => ({ id: item.id, label: item.label })),
        active: true,
        entries: {
          deleteMany: {},
          create: category.items.map((item) => ({ label: item.label, sortOrder: item.sortOrder })),
        },
      },
      create: {
        id: `fixed-${category.id}`,
        name: `${category.name} checklist`,
        categoryId: category.id,
        createdBy: admin.id,
        serviceCategory: category.id,
        items: category.items.map((item) => ({ id: item.id, label: item.label })),
        active: true,
        entries: {
          create: category.items.map((item) => ({ label: item.label, sortOrder: item.sortOrder })),
        },
      },
    });
  }

  await prisma.brandingSettings.upsert({
    where: { id: 'singleton' },
    update: { logoFilename: 'TKMR_Logo.png', updatedBy: admin.id },
    create: { id: 'singleton', logoFilename: 'TKMR_Logo.png', updatedBy: admin.id },
  });

  void finance;
  console.log('Seeded: 7 users, 2 contacts, 2 clients, 2 vessels, 2 job orders (DRAFT + IN_PROGRESS), 5 devices, 6 checklist categories.');
  console.log(`Local login password for all seed users: ${PW}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
