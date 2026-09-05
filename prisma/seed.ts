// Synthetic seed (S0-7). PDPA/INFRA-1: SYNTHETIC DATA ONLY — no real client or personal data.
// One user per role, 2 clients, 2 vessels, 2 Job Orders in different states (+ status history).
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password.js';

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

  console.log('Seeded: 5 users, 2 contacts, 2 clients, 2 vessels, 2 job orders (DRAFT + IN_PROGRESS).');
  console.log(`Local login password for all seed users: ${PW}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());