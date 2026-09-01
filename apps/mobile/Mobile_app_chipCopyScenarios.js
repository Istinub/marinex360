// =====================================================================
// MarineX360 — D-062 chip/panel copy verification
// Hardware-independent verification of sync-copy logic and bucket text.
// =====================================================================

import { errorDetailCopy, errorShortLabel, stateProgressionVocabulary, syncBucketDefinitions } from './src/lib/syncCopy.ts';

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

function verifyStatus(status, expectedShort, expectedDetail, options = {}) {
  const shortValue = errorShortLabel(status);
  const detailValue = errorDetailCopy(status, options.serverMessage);

  check(`${status} short label`, shortValue === expectedShort, `expected "${expectedShort}", got "${shortValue}"`);
  check(`${status} detail`, detailValue === expectedDetail, `expected "${expectedDetail}", got "${detailValue}"`);
}

console.log('\n══════════ MarineX360 · D-062 chip copy verification ══════════');

verifyStatus('NOT_FOUND', 'Job or record no longer available', 'saved work is still on this device');
verifyStatus('BRANCH_SCOPE_DENIED', 'Job access changed', 'contact your supervisor');
verifyStatus('STATE_TRANSITION_INVALID', 'Job status changed', 'the job changed while you were offline');
verifyStatus('VERSION_CONFLICT', 'Retry needed', 'This job was updated elsewhere. Your changes will be reapplied automatically on next sync.');
verifyStatus('VALIDATION_ERROR', 'Retry needed', 'Check the entry and try again — some fields need correction.');

check('VALIDATION_ERROR detail is actionable and distinct from short label',
  errorDetailCopy('VALIDATION_ERROR') !== errorShortLabel('VALIDATION_ERROR'),
  `detail="${errorDetailCopy('VALIDATION_ERROR')}" short="${errorShortLabel('VALIDATION_ERROR')}"`);

const forbiddenWithReason = errorDetailCopy('FORBIDDEN', 'You are not allowed to modify this job in this branch.');
check('FORBIDDEN prefers provided server message', forbiddenWithReason === 'You are not allowed to modify this job in this branch.',
  `got "${forbiddenWithReason}"`);

check('FORBIDDEN falls back to generic text when message is absent',
  errorDetailCopy('FORBIDDEN') === 'You do not have permission to perform this action.',
  `got "${errorDetailCopy('FORBIDDEN')}"`);

for (const status of ['UNAUTHORIZED', 'APPLIED', 'APPLIED_FLAGGED', 'IDEMPOTENT_REPLAY', 'BATCH_REJECTED_SCHEMA']) {
  const shortValue = errorShortLabel(status);
  const detailValue = errorDetailCopy(status);
  check(`${status} has defined short label`, shortValue && shortValue !== 'Retry needed', `got "${shortValue}"`);
  check(`${status} has defined detail`, detailValue && detailValue.trim().length > 0 && detailValue !== 'Retry needed', `got "${detailValue}"`);
}

const expectedProgression = [
  'Queued',
  'Sending...',
  'Synced',
  'Sent (pending review)',
  'Retry needed',
  'Job or record no longer available',
  'Job access changed',
  'Job status changed',
];

check('state progression vocabulary present',
  expectedProgression.every((phrase) => stateProgressionVocabulary.includes(phrase)) &&
  stateProgressionVocabulary.indexOf('Queued') < stateProgressionVocabulary.indexOf('Sending...') &&
  stateProgressionVocabulary.indexOf('Sending...') < stateProgressionVocabulary.indexOf('Synced') &&
  stateProgressionVocabulary.indexOf('Synced') < stateProgressionVocabulary.indexOf('Sent (pending review)') &&
  stateProgressionVocabulary.indexOf('Sent (pending review)') < stateProgressionVocabulary.indexOf('Retry needed') &&
  stateProgressionVocabulary.indexOf('Retry needed') < stateProgressionVocabulary.indexOf('Job or record no longer available') &&
  stateProgressionVocabulary.indexOf('Job or record no longer available') < stateProgressionVocabulary.indexOf('Job access changed') &&
  stateProgressionVocabulary.indexOf('Job access changed') < stateProgressionVocabulary.indexOf('Job status changed'),
  `got "${stateProgressionVocabulary.join(' → ')}"`);

const bucketTitles = syncBucketDefinitions.map((bucket) => bucket.title);
check('bucket text vocabulary includes exact ratified progression',
  bucketTitles.includes('Queued') &&
  bucketTitles.includes('Sending...') &&
  bucketTitles.includes('Synced') &&
  bucketTitles.includes('Sent (pending review)') &&
  bucketTitles.includes('Retry needed'),
  `bucket titles: ${JSON.stringify(bucketTitles)}`);

check('icon + text pairing exists for each bucket',
  syncBucketDefinitions.every((bucket) => !!bucket.icon && !!bucket.title && !!bucket.statusLabel),
  `missing icon/title/text in ${JSON.stringify(syncBucketDefinitions)}`);

console.log(`\n══════════ RESULT: ${pass} passed, ${fail} failed ══════════`);

if (fail > 0) {
  process.exitCode = 1;
}
