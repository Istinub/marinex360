import './assets/tokens.css';
import 'primeicons/primeicons.css';
import './assets/app.css';

import { Capacitor } from '@capacitor/core';
import { defineCustomElements } from 'jeep-sqlite/loader';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { installMarineXThemeUtilities, marineXPreset } from './theme/primevue-preset';

async function bootstrap(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    defineCustomElements(window);
    const { initializeWebDatabase } = await import('./lib/mobileDatabase');
    await initializeWebDatabase();
  }

  installMarineXThemeUtilities();

  createApp(App)
    .use(createPinia())
    .use(router)
    .use(PrimeVue, {
      ripple: true,
      theme: {
        preset: marineXPreset,
        options: {
          darkModeSelector: '.mx-dark',
        },
      },
    })
    .mount('#app');
}

void bootstrap();
