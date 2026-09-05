<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

interface NavItem {
  label: string;
  to: string;
  internal?: boolean;
  client?: boolean;
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', internal: true },
  { label: 'Clients', to: '/clients', internal: true },
  { label: 'Vessels', to: '/vessels', internal: true },
  { label: 'Job Orders', to: '/job-orders', internal: true },
  { label: 'Trash', to: '/job-orders/trash', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
  { label: 'Archive', to: '/job-orders/archive', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
  { label: 'My dashboard', to: '/client-dashboard', client: true },
  { label: 'Job requests', to: '/job-requests', internal: true, roles: ['OPS_SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'] },
];

const auth = useAuthStore();
const router = useRouter();
const tkmrLockupSrc = `${import.meta.env.BASE_URL}tkmr_new.png`;
const isUserMenuOpen = ref(false);
const visibleNavItems = computed(() => navItems.filter((item) => {
  const roles = auth.identity?.roles ?? [];
  if (item.client) return roles.includes('CLIENT');
  if (item.roles) return item.roles.some((role) => roles.includes(role));
  if (item.internal) return !roles.includes('CLIENT');
  return true;
}));

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
            v-for="item in visibleNavItems"
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
