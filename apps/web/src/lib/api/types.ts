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

export interface DeviceUserLookup {
  id: string;
  name: string;
  email: string;
  roles: string[];
  branch: string;
}

export interface Device {
  id: string;
  name?: string | null;
  assignedUserId: string;
  branch: string;
  createdAt: string;
  assignedUser?: DeviceUserLookup;
}

export interface Vendor {
  id: string;
  branch: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  deletedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandingSettings {
  id: string;
  logoFilename: string;
  updatedBy?: string | null;
  updatedAt: string;
  availableLogoFilenames: string[];
}


export interface JobStatusHistoryEntry {
  id: string;
  jobOrderId: string;
  fromState: JobState;
  toState: JobState;
  actorId: string;
  deviceId?: string | null;
  reason?: string | null;
  at: string;
  actor?: Pick<User, 'id' | 'name' | 'email'>;
  device?: Pick<Device, 'id' | 'name'> | null;
}

export interface ChecklistTemplateItem {
  id: string;
  categoryId: string;
  label: string;
  sortOrder: number;
}

export interface ChecklistCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: ChecklistTemplateItem[];
}

export interface ChecklistTemplateEntry {
  id: string;
  templateId: string;
  label: string;
  sortOrder: number;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  categoryId?: string | null;
  createdBy: string;
  createdAt: string;
  active: boolean;
  version: number;
  entries: ChecklistTemplateEntry[];
}

export interface JobOrderChecklistItem {
  id: string;
  jobOrderId: string;
  label: string;
  sortOrder: number;
  checked: boolean;
}

export interface JobOrderWorker {
  id: string;
  jobOrderId: string;
  name: string;
  addedAt: string;
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
  vendorId?: string | null;
  isSubcontracted: boolean;
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
  deadline?: string | null;
  reportObjectKey?: string | null;
  deletedAt?: string | null;
  archivedAt?: string | null;
  purgedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  variations: Variation[];
  client?: Pick<Client, 'id' | 'name'> | null;
  vessel?: Pick<Vessel, 'id' | 'name' | 'imoNumber'> | null;
  vendor?: Pick<Vendor, 'id' | 'name'> | null;
  statusHistory?: JobStatusHistoryEntry[];
  invoices?: Invoice[];
  checklistItems?: JobOrderChecklistItem[];
  workers?: JobOrderWorker[];
}

export type VariationStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED';

export interface Variation {
  id: string;
  jobOrderId: string;
  reason: string;
  amountMinor: number;
  amountCurrency: string;
  vendorId?: string | null;
  isSubcontracted: boolean;
  status: VariationStatus;
  approverId?: string | null;
  version: number;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  jobOrderId: string;
  branch: string;
  status: string;
  billToName?: string;
  billToAddress?: string | null;
  billToEmail?: string | null;
  gstAmountMinor?: number | null;
  gstCurrency?: string | null;
  totalAmountMinor: number;
  totalCurrency: string;
  issuedAt?: string | null;
  dueAt?: string | null;
  pdfObjectKey?: string | null;
  version?: number;
  createdAt?: string;
  lines?: InvoiceLine[];
  payments?: Payment[];
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  kind: string;
  description: string;
  quantity: number | string;
  unit?: string | null;
  unitPriceAmountMinor: number;
  unitPriceCurrency: string;
  lineTotalAmountMinor: number;
  lineTotalCurrency: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
}
