export interface Money {
  amountMinor: number;
  currency: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  branch: string;
  designation?: string | null;
  baseLocation?: string | null;
  skills: string[];
  available: boolean;
  mfaEnrolled: boolean;
  active: boolean;
  version: number;
}

export interface Client {
  id: string;
  branch: string;
  name: string;
  address?: string | null;
  creditTerms?: string | null;
  status: string;
  primaryContactId?: string | null;
  version: number;
}

export interface ClientDetail extends Client {
  primaryContact?: Contact | null;
  vessels: Vessel[];
}

export interface Contact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  anonymised: boolean;
  version: number;
}

export interface Vessel {
  id: string;
  clientId: string;
  imoNumber: string;
  name: string;
  type?: string | null;
  flag?: string | null;
  classification?: string | null;
  version: number;
}

export interface JobOrderSummary {
  id: string;
  joNumber: string;
  state: JobState;
  scopeSummary: string;
  plannedStartDate?: string | null;
}

export type JobState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'PENDING_REVIEW'
  | 'COMPLETED'
  | 'INVOICED'
  | 'CLOSED'
  | 'ON_HOLD'
  | 'CANCELLED';

export interface JobOrder {
  id: string;
  joNumber: string;
  branch: string;
  clientId: string;
  vesselId: string;
  serviceCategories: string[];
  port?: string | null;
  scopeSummary: string;
  origin: string;
  externalQuoteRef?: string | null;
  externalRfqRef?: string | null;
  quotedAmountMinor: number;
  quotedCurrency: string;
  labourRateAmountMinor?: number | null;
  labourRateCurrency?: string | null;
  state: JobState;
  assignedTechnicianIds: string[];
  executionOwnerId?: string | null;
  plannedStartDate?: string | null;
  version: number;
}

export type VariationStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED';

export interface Variation {
  id: string;
  jobOrderId: string;
  reason: string;
  amountMinor: number;
  amountCurrency: string;
  status: VariationStatus;
  approverId?: string | null;
  version: number;
  createdAt: string;
}
