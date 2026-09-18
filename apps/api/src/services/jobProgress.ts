// Public "client progress link" (no login): a random opaque shareToken stands in for the job's
// real id/joNumber in the public URL (same never-expose-internal-ids reasoning as elsewhere).
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors.js';

export const newShareToken = (): string => randomBytes(32).toString('base64url');

export interface PublicJobProgress {
  joNumber: string;
  vesselName: string;
  clientName: string;
  state: string;
  deadline: Date | null;
  lastUpdatedAt: Date | null;
  timeline: Array<{ fromState: string; toState: string; at: Date }>;
  invoiceStatus: string;
  quotedAmountMinor: number;
  approvedVariationsTotalMinor: number;
  projectedTotalMinor: number;
  currency: string;
}

export async function getPublicJobProgress(prisma: PrismaClient, token: string): Promise<PublicJobProgress> {
  const jo = await prisma.jobOrder.findFirst({
    where: { shareToken: token, deletedAt: null, archivedAt: null, purgedAt: null },
    include: {
      client: { select: { name: true } },
      vessel: { select: { name: true } },
      variations: { select: { status: true, amountMinor: true, amountCurrency: true } },
      statusHistory: { select: { fromState: true, toState: true, at: true }, orderBy: { at: 'asc' } },
      invoices: {
        select: { status: true, dueAt: true, totalAmountMinor: true, payments: { select: { amountMinor: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!jo) throw new AppError('NOT_FOUND'); // never distinguish "invalid token" from "not found"

  let approvedVariationsTotalMinor = 0;
  for (const variation of jo.variations) {
    if (variation.status !== 'APPROVED') continue;
    if (variation.amountCurrency !== jo.quotedCurrency) {
      throw new AppError('VALIDATION_ERROR', `variation currency "${variation.amountCurrency}" does not match quoted currency "${jo.quotedCurrency}" (no conversion, D-031)`);
    }
    approvedVariationsTotalMinor += variation.amountMinor;
  }

  const timeline = jo.statusHistory.map((entry) => ({ fromState: entry.fromState, toState: entry.toState, at: entry.at }));

  return {
    joNumber: jo.joNumber,
    vesselName: jo.vessel.name,
    clientName: jo.client.name,
    state: jo.state,
    deadline: jo.deadline,
    lastUpdatedAt: timeline.at(-1)?.at ?? null,
    timeline,
    invoiceStatus: invoiceStatusLabel(jo.invoices[0] ?? null),
    quotedAmountMinor: jo.quotedAmountMinor,
    approvedVariationsTotalMinor,
    projectedTotalMinor: jo.quotedAmountMinor + approvedVariationsTotalMinor,
    currency: jo.quotedCurrency,
  };
}

function invoiceStatusLabel(invoice: {
  status: string;
  dueAt: Date | null;
  totalAmountMinor: number;
  payments: { amountMinor: number }[];
} | null): string {
  if (!invoice || invoice.status === 'DRAFT') return 'Not yet invoiced';
  const paidMinor = invoice.payments.reduce((total, payment) => total + payment.amountMinor, 0);
  if (paidMinor >= invoice.totalAmountMinor || invoice.status === 'PAID') return 'Paid';
  if (invoice.status === 'OVERDUE' || (invoice.dueAt && invoice.dueAt.getTime() < Date.now())) return 'Overdue';
  if (invoice.status === 'PARTIAL') return 'Partially paid';
  if (invoice.status === 'SENT') return 'Sent';
  return invoice.status.toLowerCase().replace(/(^|_)([a-z])/g, (_match, separator, char) => `${separator ? ' ' : ''}${char.toUpperCase()}`);
}
