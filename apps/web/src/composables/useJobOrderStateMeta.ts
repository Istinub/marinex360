import type { JobState } from '@/lib/api/types';

export interface JobOrderStateMeta {
  label: string;
  className: string;
  textColor: string;
  backgroundColor: string;
}

const JOB_ORDER_STATE_META: Record<JobState, JobOrderStateMeta> = {
  DRAFT: { label: 'Draft', className: 'mx-jo-draft', textColor: '#44525E', backgroundColor: '#ECEFF2' },
  SCHEDULED: { label: 'Scheduled', className: 'mx-jo-scheduled', textColor: '#0F4C92', backgroundColor: '#E2EFFC' },
  IN_PROGRESS: { label: 'In progress', className: 'mx-jo-inprogress', textColor: '#8A4B00', backgroundColor: '#FFF1DC' },
  PENDING_REVIEW: { label: 'Pending review', className: 'mx-jo-review', textColor: '#5B2A86', backgroundColor: '#F0E7F8' },
  COMPLETED: { label: 'Completed', className: 'mx-jo-completed', textColor: '#14692F', backgroundColor: '#E3F3E8' },
  INVOICED: { label: 'Invoiced', className: 'mx-jo-invoiced', textColor: '#0A5E66', backgroundColor: '#E2F3F4' },
  CLOSED: { label: 'Closed', className: 'mx-jo-closed', textColor: '#2A3A47', backgroundColor: '#DEE4E9' },
  ON_HOLD: { label: 'On hold', className: 'mx-jo-onhold', textColor: '#7A5A00', backgroundColor: '#FBF1C9' },
  CANCELLED: { label: 'Cancelled', className: 'mx-jo-cancelled', textColor: '#7A2E2E', backgroundColor: '#F3E0E0' },
};

export function jobOrderStateMeta(state: JobState): JobOrderStateMeta {
  return JOB_ORDER_STATE_META[state];
}

export function jobOrderStateLabel(state: JobState): string {
  return jobOrderStateMeta(state).label;
}

export function jobOrderStateClass(state: JobState): string {
  return jobOrderStateMeta(state).className;
}
