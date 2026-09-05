import type { ChecklistItemDef } from '@/composables/useOfflineExecution';

export type JobOrderCategory = 'inspection' | 'electrical' | 'mechanical' | 'hull' | 'safety' | 'other';

export const JOB_ORDER_CATEGORY_OPTIONS: { value: JobOrderCategory; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'hull', label: 'Hull' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' },
];

// P3-11 future work: replace these fixed demo lists with Director-editable checklist templates.
const CATEGORY_CHECKLIST_ITEMS: Record<JobOrderCategory, ChecklistItemDef[]> = {
  inspection: [
    { id: 'inspection-visual-condition', label: 'Visual condition checked', type: 'bool', required: true },
    { id: 'inspection-findings', label: 'Inspection findings', type: 'text', required: true },
    { id: 'inspection-access', label: 'Access and work area safe', type: 'bool', required: true },
    { id: 'inspection-photo', label: 'Condition photo', type: 'photo', required: false },
  ],
  electrical: [
    { id: 'electrical-isolated', label: 'Electrical isolation confirmed', type: 'bool', required: true },
    { id: 'electrical-voltage', label: 'Voltage reading', type: 'number', required: false, unit: 'V' },
    { id: 'electrical-cable-condition', label: 'Cable condition', type: 'select', required: true, options: ['Good', 'Worn', 'Damaged'] },
    { id: 'electrical-notes', label: 'Electrical notes', type: 'text', required: false },
  ],
  mechanical: [
    { id: 'mechanical-guards', label: 'Guards and covers secured', type: 'bool', required: true },
    { id: 'mechanical-vibration', label: 'Abnormal vibration observed', type: 'bool', required: true },
    { id: 'mechanical-temperature', label: 'Running temperature', type: 'number', required: false, unit: 'C' },
    { id: 'mechanical-observation', label: 'Mechanical observation', type: 'text', required: true },
  ],
  hull: [
    { id: 'hull-coating', label: 'Coating condition', type: 'select', required: true, options: ['Good', 'Fair', 'Poor'] },
    { id: 'hull-corrosion', label: 'Corrosion present', type: 'bool', required: true },
    { id: 'hull-damage-notes', label: 'Damage notes', type: 'text', required: false },
    { id: 'hull-photo', label: 'Hull photo', type: 'photo', required: false },
  ],
  safety: [
    { id: 'safety-permit', label: 'Permit to work checked', type: 'bool', required: true },
    { id: 'safety-ppe', label: 'PPE in use', type: 'bool', required: true },
    { id: 'safety-hazards', label: 'Hazards identified', type: 'text', required: true },
    { id: 'safety-controls', label: 'Controls in place', type: 'bool', required: true },
  ],
  other: [
    { id: 'other-task-summary', label: 'Task summary', type: 'text', required: true },
    { id: 'other-completed', label: 'Work completed as requested', type: 'bool', required: true },
    { id: 'other-follow-up', label: 'Follow-up required', type: 'bool', required: false },
    { id: 'other-photo', label: 'Supporting photo', type: 'photo', required: false },
  ],
};

export function checklistItemsForCategory(category: JobOrderCategory): ChecklistItemDef[] {
  return CATEGORY_CHECKLIST_ITEMS[category].map((item) => ({ ...item, options: item.options ? [...item.options] : undefined }));
}

export function isJobOrderCategory(value: string): value is JobOrderCategory {
  return JOB_ORDER_CATEGORY_OPTIONS.some((category) => category.value === value);
}
