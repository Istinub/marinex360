/**
 * MarineX360 — local seed (synthetic data ONLY; PDPA / INFRA-1).
 *
 * No real client or personal data, ever, on local machines or in commits. This script
 * generates fake records with @faker-js/faker.
 *
 * Written against the TEMPORARY BASELINE models (the 6 core contract entities). When
 * TL/BE's canonical ~24-model schema lands, extend this to cover the new models and
 * reconcile any renamed fields. Run: `npm run db:seed`.
 */
import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

const BRANCHES = ["SG", "MY", "ID", "BD"] as const;
const CURRENCIES = ["SGD", "USD", "MYR", "IDR"] as const;
const SERVICE_CATEGORIES = [
  "PROPULSION_MACHINERY",
  "FLUID_THERMAL",
  "ELECTRICAL_AUTOMATION",
  "DECK_HYDRAULICS_STRUCTURAL",
  "FLEET_OPS_SUPPORT",
  "ADVISORY_COMPLIANCE",
] as const;
const STATES = ["DRAFT", "SCHEDULED", "IN_PROGRESS", "PENDING_REVIEW", "COMPLETED"] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  faker.seed(42); // deterministic local data

  // Clean slate (idempotent local seed). Order respects FKs.
  await prisma.jobStatusHistory.deleteMany();
  await prisma.jobOrder.deleteMany();
  await prisma.vessel.deleteMany();
  await prisma.client.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.processedOp.deleteMany();

  let joCounter = 1;

  for (const branch of BRANCHES) {
    for (let c = 0; c < 4; c++) {
      const contact = await prisma.contact.create({
        data: {
          name: faker.person.fullName(),
          email: faker.internet.email(),
          phone: faker.phone.number(),
        },
      });

      const client = await prisma.client.create({
        data: {
          branch,
          name: `${faker.company.name()} Shipping`,
          address: faker.location.streetAddress({ useFullAddress: true }),
          creditTerms: pick(["NET30", "NET45", "NET60"]),
          status: pick(["ACTIVE", "PROSPECT", "INACTIVE"]),
          primaryContactId: contact.id,
        },
      });

      const vesselCount = faker.number.int({ min: 1, max: 3 });
      for (let v = 0; v < vesselCount; v++) {
        const vessel = await prisma.vessel.create({
          data: {
            clientId: client.id,
            imoNumber: faker.string.numeric(7),
            name: `MV ${faker.word.noun()} ${faker.string.alpha({ length: 2, casing: "upper" })}`,
            type: pick(["Bulk Carrier", "Tanker", "Container", "Offshore Supply"]),
            flag: pick(["Singapore", "Panama", "Liberia", "Marshall Islands"]),
            classification: pick(["ABS", "DNV", "Lloyd's Register", "BV"]),
          },
        });

        const joPerVessel = faker.number.int({ min: 1, max: 3 });
        for (let j = 0; j < joPerVessel; j++) {
          const state = pick(STATES);
          const currency = pick(CURRENCIES);
          const jo = await prisma.jobOrder.create({
            data: {
              joNumber: `${branch}-JO-${String(joCounter++).padStart(5, "0")}`,
              branch,
              clientId: client.id,
              vesselId: vessel.id,
              serviceCategories: faker.helpers.arrayElements(SERVICE_CATEGORIES, { min: 1, max: 2 }),
              port: pick(["Singapore", "Port Klang", "Tanjung Priok", "Chittagong"]),
              scopeSummary: faker.lorem.sentence(),
              origin: "MANUAL",
              externalQuoteRef: faker.datatype.boolean() ? `RFQ-${faker.string.numeric(6)}` : null,
              quotedAmountMinor: faker.number.int({ min: 50_000, max: 50_000_00 }),
              quotedCurrency: currency,
              state,
              assignedTechnicianIds:
                state === "DRAFT" ? [] : [faker.string.uuid()],
              plannedStartDate: faker.date.soon({ days: 30 }),
              createdBy: faker.string.uuid(),
            },
          });

          // A couple of immutable transition records for non-DRAFT jobs.
          if (state !== "DRAFT") {
            await prisma.jobStatusHistory.create({
              data: {
                jobOrderId: jo.id,
                fromState: "DRAFT",
                toState: "SCHEDULED",
                actorId: faker.string.uuid(),
              },
            });
          }
        }
      }
    }
  }

  const counts = {
    contacts: await prisma.contact.count(),
    clients: await prisma.client.count(),
    vessels: await prisma.vessel.count(),
    jobOrders: await prisma.jobOrder.count(),
    history: await prisma.jobStatusHistory.count(),
  };
  console.log("Seed complete (synthetic data only):", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
