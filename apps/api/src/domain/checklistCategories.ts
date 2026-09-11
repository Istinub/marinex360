export interface SeedChecklistItem {
  id: string;
  label: string;
}

export interface SeedChecklistCategory {
  id: string;
  name: string;
  items: SeedChecklistItem[];
}

export const SEEDED_CHECKLIST_CATEGORIES: SeedChecklistCategory[] = [
  {
    id: 'inspection',
    name: 'Inspection',
    items: [
      { id: 'inspection-visual-condition', label: 'Visual condition checked' },
      { id: 'inspection-findings', label: 'Inspection findings noted' },
      { id: 'inspection-access', label: 'Access and work area safe' },
      { id: 'inspection-photo', label: 'Condition documented' },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical',
    items: [
      { id: 'electrical-isolated', label: 'Electrical isolation confirmed' },
      { id: 'electrical-voltage', label: 'Voltage checked' },
      { id: 'electrical-cable-condition', label: 'Cable condition checked' },
      { id: 'electrical-notes', label: 'Electrical notes captured' },
    ],
  },
  {
    id: 'mechanical',
    name: 'Mechanical',
    items: [
      { id: 'mechanical-guards', label: 'Guards and covers secured' },
      { id: 'mechanical-vibration', label: 'Vibration checked' },
      { id: 'mechanical-temperature', label: 'Running temperature checked' },
      { id: 'mechanical-observation', label: 'Mechanical observation captured' },
    ],
  },
  {
    id: 'hull',
    name: 'Hull',
    items: [
      { id: 'hull-coating', label: 'Coating condition checked' },
      { id: 'hull-corrosion', label: 'Corrosion checked' },
      { id: 'hull-damage-notes', label: 'Damage notes captured' },
      { id: 'hull-photo', label: 'Hull condition documented' },
    ],
  },
  {
    id: 'safety',
    name: 'Safety',
    items: [
      { id: 'safety-permit', label: 'Permit to work checked' },
      { id: 'safety-ppe', label: 'PPE in use' },
      { id: 'safety-hazards', label: 'Hazards identified' },
      { id: 'safety-controls', label: 'Controls in place' },
    ],
  },
  {
    id: 'other',
    name: 'Other',
    items: [
      { id: 'other-task-summary', label: 'Task summary captured' },
      { id: 'other-completed', label: 'Work completed as requested' },
      { id: 'other-follow-up', label: 'Follow-up checked' },
      { id: 'other-photo', label: 'Supporting documentation captured' },
    ],
  },
];
