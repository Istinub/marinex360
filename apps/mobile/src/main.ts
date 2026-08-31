import './assets/tokens.css';
import 'primeicons/primeicons.css';
import './assets/app.css';

import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { installMarineXThemeUtilities, marineXPreset } from './theme/primevue-preset';

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
