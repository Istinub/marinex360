export interface SyncBucketDefinition {
  key: 'pending' | 'syncing' | 'synced' | 'retry' | 'flagged';
  title: string;
  statusLabel: string;
  icon: string;
}

export const syncBucketDefinitions: SyncBucketDefinition[] = [
  {
    key: 'pending',
    title: 'Queued',
    statusLabel: 'Queued',
    icon: 'pi pi-clock',
  },
  {
    key: 'syncing',
    title: 'Sending...',
    statusLabel: 'Sending...',
    icon: 'pi pi-upload',
  },
  {
    key: 'synced',
    title: 'Synced',
    statusLabel: 'Synced',
    icon: 'pi pi-check-circle',
  },
  {
    key: 'retry',
    title: 'Retry needed',
    statusLabel: 'Retry needed',
    icon: 'pi pi-exclamation-triangle',
  },
  {
    key: 'flagged',
    title: 'Sent (pending review)',
    statusLabel: 'Sent (pending review)',
    icon: 'pi pi-eye',
  },
];

export const stateProgressionVocabulary = [
  'Queued',
  'Sending...',
  'Synced',
  'Sent (pending review)',
  'Retry needed',
  'Job or record no longer available',
  'Job access changed',
  'Job status changed',
];

export function errorShortLabel(status: string): string {
  const normalized = status.trim();

  switch (normalized) {
    case 'APPLIED':
      return 'Synced';
    case 'APPLIED_FLAGGED':
      return 'Sent (pending review)';
    case 'IDEMPOTENT_REPLAY':
      return 'Synced';
    case 'UNAUTHORIZED':
      return 'Session expired';
    case 'BATCH_REJECTED_SCHEMA':
      return 'Update required';
    case 'NOT_FOUND':
      return 'Job or record no longer available';
    case 'BRANCH_SCOPE_DENIED':
      return 'Job access changed';
    case 'STATE_TRANSITION_INVALID':
      return 'Job status changed';
    case 'VALIDATION_ERROR':
    case 'VERSION_CONFLICT':
      return 'Retry needed';
    case 'FORBIDDEN':
      return 'Permission issue';
    default:
      return 'Retry needed';
  }
}

export function errorDetailCopy(status: string, serverMessage?: string): string {
  const normalized = status.trim();
  const reasons = serverMessage?.trim();

  switch (normalized) {
    case 'APPLIED':
      return 'This change synced successfully.';
    case 'APPLIED_FLAGGED':
      return 'This change was sent for review.';
    case 'IDEMPOTENT_REPLAY':
      return 'This change was already applied.';
    case 'UNAUTHORIZED':
      return 'Your session is no longer authorised to sync this change. Please sign back in and try again.';
    case 'BATCH_REJECTED_SCHEMA':
      return 'This update needs a newer app version before it can sync.';
    case 'VALIDATION_ERROR':
      return reasons || 'Check the entry and try again — some fields need correction.';
    case 'VERSION_CONFLICT':
      return 'This job was updated elsewhere. Your changes will be reapplied automatically on next sync.';
    case 'FORBIDDEN':
      return reasons || 'You do not have permission to perform this action.';
    case 'NOT_FOUND':
      return 'saved work is still on this device';
    case 'BRANCH_SCOPE_DENIED':
      return 'contact your supervisor';
    case 'STATE_TRANSITION_INVALID':
      return 'the job changed while you were offline';
    default:
      return reasons || 'Retry needed';
  }
}
