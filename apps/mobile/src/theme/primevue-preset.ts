import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

const navyScale = {
  50: 'var(--c-navy-050)',
  100: 'var(--c-navy-300)',
  200: 'var(--c-navy-300)',
  300: 'var(--c-navy-300)',
  400: 'var(--c-navy-600)',
  500: 'var(--c-navy-600)',
  600: 'var(--c-navy-600)',
  700: 'var(--c-navy-800)',
  800: 'var(--c-navy-800)',
  900: 'var(--c-navy-900)',
  950: 'var(--c-navy-900)',
} as const;

const statusTokens = ['pending', 'syncing', 'synced', 'error'] as const;
const jobOrderTokens = [
  'draft',
  'scheduled',
  'inprogress',
  'review',
  'completed',
  'invoiced',
  'closed',
  'onhold',
  'cancelled',
] as const;

export const marineXPreset = definePreset(Aura, {
  semantic: {
    primary: navyScale,
  },
});

function pillClass(selector: string, tokenPrefix: string): string {
  return `
${selector} {
  color: var(--${tokenPrefix}-fg);
  background: var(--${tokenPrefix}-bg);
  border-radius: var(--radius-pill);
}`;
}

export function installMarineXThemeUtilities(ownerDocument: Document = document): void {
  const styleId = 'marinex360-token-utilities';
  if (ownerDocument.getElementById(styleId)) return;

  const css = [
    ...statusTokens.map((status) => pillClass(`.mx-status-${status}`, `status-${status}`)),
    ...jobOrderTokens.map((status) => pillClass(`.mx-jo-${status}`, `jo-${status}`)),
  ].join('\n');

  const style = ownerDocument.createElement('style');
  style.id = styleId;
  style.textContent = css;
  ownerDocument.head.append(style);
}
