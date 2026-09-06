export interface SeedChecklistItem {
  id: string;
  label: string;
  sortOrder: number;
}

export interface SeedChecklistCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: SeedChecklistItem[];
}

export const SEEDED_CHECKLIST_CATEGORIES: SeedChecklistCategory[] = [
  {
    id: 'inspection',
    name: 'Inspection',
    sortOrder: 10,
    items: [
      { id: 'inspection-visual-condition', label: 'Visual condition checked', sortOrder: 10 },
      { id: 'inspection-findings', label: 'Inspection findings noted', sortOrder: 20 },
      { id: 'inspection-access', label: 'Access and work area safe', sortOrder: 30 },
      { id: 'inspection-photo', label: 'Condition documented', sortOrder: 40 },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical',
    sortOrder: 20,
    items: [
      { id: 'electrical-isolated', label: 'Electrical isolation confirmed', sortOrder: 10 },
      { id: 'electrical-voltage', label: 'Voltage checked', sortOrder: 20 },
      { id: 'electrical-cable-condition', label: 'Cable condition checked', sortOrder: 30 },
      { id: 'electrical-notes', label: 'Electrical notes captured', sortOrder: 40 },
    ],
  },
  {
    id: 'mechanical',
    name: 'Mechanical',
    sortOrder: 30,
    items: [
      { id: 'mechanical-guards', label: 'Guards and covers secured', sortOrder: 10 },
      { id: 'mechanical-vibration', label: 'Vibration checked', sortOrder: 20 },
      { id: 'mechanical-temperature', label: 'Running temperature checked', sortOrder: 30 },
      { id: 'mechanical-observation', label: 'Mechanical observation captured', sortOrder: 40 },
    ],
  },
  {
    id: 'hull',
    name: 'Hull',
    sortOrder: 40,
    items: [
      { id: 'hull-coating', label: 'Coating condition checked', sortOrder: 10 },
      { id: 'hull-corrosion', label: 'Corrosion checked', sortOrder: 20 },
      { id: 'hull-damage-notes', label: 'Damage notes captured', sortOrder: 30 },
      { id: 'hull-photo', label: 'Hull condition documented', sortOrder: 40 },
    ],
  },
  {
    id: 'safety',
    name: 'Safety',
    sortOrder: 50,
    items: [
      { id: 'safety-permit', label: 'Permit to work checked', sortOrder: 10 },
      { id: 'safety-ppe', label: 'PPE in use', sortOrder: 20 },
      { id: 'safety-hazards', label: 'Hazards identified', sortOrder: 30 },
      { id: 'safety-controls', label: 'Controls in place', sortOrder: 40 },
    ],
  },
  {
    id: 'other',
    name: 'Other',
    sortOrder: 60,
    items: [
      { id: 'other-task-summary', label: 'Task summary captured', sortOrder: 10 },
      { id: 'other-completed', label: 'Work completed as requested', sortOrder: 20 },
      { id: 'other-follow-up', label: 'Follow-up checked', sortOrder: 30 },
      { id: 'other-photo', label: 'Supporting documentation captured', sortOrder: 40 },
    ],
  },
];
