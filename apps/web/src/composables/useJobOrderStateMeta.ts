import type { JobState } from '@/lib/api/types';

export interface JobOrderStateMeta {
  label: string;
  className: string;
}

const JOB_ORDER_STATE_META: Record<JobState, JobOrderStateMeta> = {
  DRAFT: { label: 'Draft', className: 'mx-jo-draft' },
  SCHEDULED: { label: 'Scheduled', className: 'mx-jo-scheduled' },
  IN_PROGRESS: { label: 'In progress', className: 'mx-jo-inprogress' },
  PENDING_REVIEW: { label: 'Pending review', className: 'mx-jo-review' },
  COMPLETED: { label: 'Completed', className: 'mx-jo-completed' },
  INVOICED: { label: 'Invoiced', className: 'mx-jo-invoiced' },
  CLOSED: { label: 'Closed', className: 'mx-jo-closed' },
  ON_HOLD: { label: 'On hold', className: 'mx-jo-onhold' },
  CANCELLED: { label: 'Cancelled', className: 'mx-jo-cancelled' },
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
