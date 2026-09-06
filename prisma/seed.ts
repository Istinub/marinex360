// Synthetic seed (S0-7). PDPA/INFRA-1: SYNTHETIC DATA ONLY — no real client or personal data.
// One user per role, 2 clients, 2 vessels, 2 Job Orders in different states (+ status history).
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password.js';
import { SEEDED_CHECKLIST_CATEGORIES } from '../apps/api/src/domain/checklistCategories.js';

// Seed runs as the owner (DIRECT_DATABASE_URL) so it can reset append-only tables.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } },
});
const PW = 'MarineX360-dev!'; // local synthetic only

async function main() {
  const pwHash = await hashPassword(PW);
  const mk = (email: string, name: string, roles: string[], branch: string, extra: Record<string, unknown> = {}) =>
    prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash: pwHash, roles, branch, ...extra } });

  const admin = await mk('admin@tkmr.local', 'Ava Admin', ['SYSTEM_ADMIN'], 'SG', { mfaEnrolled: false });
  const finance = await mk('finance@tkmr.local', 'Finn Finance', ['FINANCE'], 'SG', { mfaEnrolled: false });
  const supervisor = await mk('ops@tkmr.local', 'Suri Supervisor', ['OPS_SUPERVISOR'], 'SG');
  const director = await mk('director@tkmr.local', 'Dinesh Director', ['DIRECTOR'], 'SG');
  const tech = await mk('tech@tkmr.local', 'Tariq Technician', ['TECHNICIAN'], 'SG',
    { skills: ['welding', 'hydraulics'], baseLocation: 'Jurong', available: true, designation: 'Senior Field Technician' });
  const tech2 = await mk('tech2@tkmr.local', 'Talia Technician', ['TECHNICIAN'], 'SG',
    { skills: ['electrical', 'inspection'], baseLocation: 'Tuas', available: true, designation: 'Field Technician' });

  const contactA = await prisma.contact.create({ data: { name: 'Operations Desk (Pacific Lines)', email: 'ops@pacificlines.example', phone: '+65-6000-0001' } });
  const contactB = await prisma.contact.create({ data: { name: 'Fleet Manager (Straits Bulk)', email: 'fleet@straitsbulk.example', phone: '+65-6000-0002' } });

  const clientA = await prisma.client.create({ data: { branch: 'SG', name: 'Pacific Lines Pte Ltd', address: '1 Maritime Sq, Singapore', creditTerms: 'NET30', primaryContactId: contactA.id } });
  const clientB = await prisma.client.create({ data: { branch: 'SG', name: 'Straits Bulk Carriers', address: '9 Keppel Rd, Singapore', creditTerms: 'NET45', primaryContactId: contactB.id } });
  await prisma.user.upsert({
    where: { email: 'client@tkmr.local' },
    update: { clientId: clientA.id, roles: ['CLIENT'], branch: 'SG', active: true, mfaEnrolled: false },
    create: { email: 'client@tkmr.local', name: 'Pacific Client', passwordHash: pwHash, roles: ['CLIENT'], branch: 'SG', clientId: clientA.id, mfaEnrolled: false },
  });

  const vesselA = await prisma.vessel.create({ data: { clientId: clientA.id, imoNumber: '9251986', name: 'MV Pacific Dawn', type: 'Bulk Carrier', flag: 'SG', classification: 'ABS' } });
  const vesselB = await prisma.vessel.create({ data: { clientId: clientB.id, imoNumber: '9411406', name: 'MV Straits Pioneer', type: 'Tanker', flag: 'SG', classification: 'DNV' } });

  // JO #1 — DRAFT
  await prisma.jobOrder.create({
    data: {
      joNumber: 'SG-2026-0001', branch: 'SG', clientId: clientA.id, vesselId: vesselA.id,
      serviceCategories: ['mechanical'], port: 'Singapore', scopeSummary: 'Main engine cooling pump overhaul',
      origin: 'MANUAL', externalQuoteRef: 'EXT-Q-5521', quotedAmountMinor: 4500000, quotedCurrency: 'SGD',
      labourRateAmountMinor: 9000, labourRateCurrency: 'SGD', state: 'DRAFT', createdBy: supervisor.id,
    },
  });

  // JO #2 — IN_PROGRESS, owned by the technician, with realistic status history.
  const jo2 = await prisma.jobOrder.create({
    data: {
      joNumber: 'SG-2026-0002', branch: 'SG', clientId: clientB.id, vesselId: vesselB.id,
      serviceCategories: ['electrical', 'inspection'], port: 'Singapore', scopeSummary: 'Switchboard thermal survey + breaker service',
      origin: 'MANUAL', quotedAmountMinor: 2800000, quotedCurrency: 'SGD',
      labourRateAmountMinor: 9000, labourRateCurrency: 'SGD', state: 'IN_PROGRESS',
      assignedTechnicianIds: [tech.id], executionOwnerId: tech.id, createdBy: supervisor.id,
    },
  });
  await prisma.jobStatusHistory.createMany({
    data: [
      { jobOrderId: jo2.id, fromState: 'DRAFT', toState: 'SCHEDULED', actorId: supervisor.id },
      { jobOrderId: jo2.id, fromState: 'SCHEDULED', toState: 'IN_PROGRESS', actorId: tech.id },
    ],
  });

  const devices = [
    { id: 'Device-1', name: 'Device-1', pin: '0000', assignedUserId: tech.id, branch: tech.branch },
    { id: 'Device-2', name: 'Device-2', pin: '0002', assignedUserId: tech2.id, branch: tech2.branch },
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
        serviceCategory: category.id,
        items: category.items.map((item) => ({ id: item.id, label: item.label })),
        active: true,
      },
      create: {
        id: `fixed-${category.id}`,
        name: `${category.name} checklist`,
        serviceCategory: category.id,
        items: category.items.map((item) => ({ id: item.id, label: item.label })),
        active: true,
      },
    });
  }

  console.log('Seeded: 6 users, 2 contacts, 2 clients, 2 vessels, 2 job orders (DRAFT + IN_PROGRESS), 4 devices, 6 checklist categories.');
  console.log(`Local login password for all seed users: ${PW}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
