export type JobOrderCategory = 'inspection' | 'electrical' | 'mechanical' | 'hull' | 'safety' | 'other';

export interface JobOrderCategoryOption {
  value: JobOrderCategory;
  label: string;
}

export const JOB_ORDER_CATEGORY_OPTIONS: JobOrderCategoryOption[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'hull', label: 'Hull' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' },
];
