<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const navItems = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Clients', to: '/clients' },
  { label: 'Vessels', to: '/vessels' },
  { label: 'Job Orders', to: '/job-orders' },
] as const;

const auth = useAuthStore();
const router = useRouter();
const tkmrLockupSrc = `${import.meta.env.BASE_URL}tkmr_new.png`;
const isUserMenuOpen = ref(false);

function toggleUserMenu(): void {
  isUserMenuOpen.value = !isUserMenuOpen.value;
}

function closeUserMenu(): void {
  isUserMenuOpen.value = false;
}

function logout(): void {
  closeUserMenu();
  auth.logout();
  void router.replace('/login');
}
</script>

<template>
  <div class="app-layout">
    <header class="app-layout__topbar">
      <RouterLink class="app-layout__brand" to="/" aria-label="MarineX360 home">
        <img class="app-layout__brand-mark" :src="tkmrLockupSrc" alt="TKMR" />
        <span class="app-layout__brand-name">MarineX360</span>
      </RouterLink>

      <div class="app-layout__user">
        <button
          class="app-layout__user-trigger"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="isUserMenuOpen"
          @click="toggleUserMenu"
        >
          <span class="pi pi-user" aria-hidden="true" />
          <span class="app-layout__user-copy">
            <span class="app-layout__user-name">{{ auth.identity?.name ?? auth.identity?.userId ?? 'Office User' }}</span>
            <span class="app-layout__user-branch">{{ auth.identity?.branch ?? 'Branch' }}</span>
          </span>
          <span class="pi pi-angle-down" aria-hidden="true" />
        </button>

        <div v-if="isUserMenuOpen" class="app-layout__user-menu" role="menu">
          <button class="app-layout__menu-item" type="button" role="menuitem" @click="logout">
            <span class="pi pi-sign-out" aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>

    <div class="app-layout__body">
      <aside class="app-layout__sidebar" aria-label="Primary">
        <nav class="app-layout__nav">
          <RouterLink
            v-for="item in navItems"
            :key="item.label"
            class="app-layout__nav-item"
            :to="item.to"
            @click="closeUserMenu"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </aside>

      <section class="app-layout__content" aria-label="Workspace">
        <RouterView />
      </section>
    </div>
  </div>
</template>
