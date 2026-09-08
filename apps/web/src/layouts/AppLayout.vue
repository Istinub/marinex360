<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

interface NavItem {
  label: string;
  to: string;
  icon: string;
  internal?: boolean;
  client?: boolean;
  roles?: string[];
}

interface NavGroup {
  label: string;
  icon: string;
  items: NavItem[];
  roles?: string[];
  client?: boolean;
  internal?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: 'Workspace',
    icon: 'pi pi-th-large',
    internal: true,
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: 'pi pi-chart-bar', internal: true },
    ],
  },
  {
    label: 'CRM',
    icon: 'pi pi-building',
    internal: true,
    items: [
      { label: 'Clients', to: '/clients', icon: 'pi pi-building', internal: true },
      { label: 'Vessels', to: '/vessels', icon: 'pi pi-compass', internal: true },
    ],
  },
  {
    label: 'Job Management',
    icon: 'pi pi-briefcase',
    internal: true,
    items: [
      { label: 'Job Orders', to: '/job-orders', icon: 'pi pi-list-check', internal: true },
      { label: 'Job Requests', to: '/job-requests', icon: 'pi pi-inbox', internal: true, roles: ['OPS_SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'] },
      { label: 'Archive', to: '/job-orders/archive', icon: 'pi pi-folder', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      { label: 'Trash', to: '/job-orders/trash', icon: 'pi pi-trash', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
    ],
  },
  {
    label: 'Reports',
    icon: 'pi pi-file-pdf',
    internal: true,
    items: [
      // TODO(ux): pending PM decision on group/item label rename
      { label: 'Reports', to: '/reports', icon: 'pi pi-file', internal: true },
    ],
  },
  {
    label: 'Business Analytics',
    icon: 'pi pi-chart-line',
    internal: true,
    items: [
      // TODO(ux): pending PM decision on group/item label rename
      { label: 'Analytics', to: '/analytics', icon: 'pi pi-chart-line', internal: true },
    ],
  },
  {
    label: 'Settings',
    icon: 'pi pi-cog',
    internal: true,
    items: [
      { label: 'Account Management', to: '/settings/account-management', icon: 'pi pi-users', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      { label: 'Job Execution Settings', to: '/settings/job-execution', icon: 'pi pi-sliders-h', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      { label: 'Branding', to: '/settings/branding', icon: 'pi pi-image', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      { label: 'Devices', to: '/settings/devices', icon: 'pi pi-tablet', internal: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
    ],
  },
  {
    label: 'App Settings',
    icon: 'pi pi-wrench',
    internal: true,
    roles: ['SYSTEM_ADMIN'],
    items: [
      { label: 'Device Troubleshooting', to: '/app-settings/device-troubleshooting', icon: 'pi pi-mobile', internal: true, roles: ['SYSTEM_ADMIN'] },
      { label: 'Error Log', to: '/app-settings/error-log', icon: 'pi pi-exclamation-triangle', internal: true, roles: ['SYSTEM_ADMIN'] },
    ],
  },
  {
    label: 'Client',
    icon: 'pi pi-home',
    client: true,
    items: [
      { label: 'My dashboard', to: '/client-dashboard', icon: 'pi pi-home', client: true },
    ],
  },
];

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const isUserMenuOpen = ref(false);
const isSidebarOpen = ref(false);
const isNarrowLayout = ref(false);
let sidebarMediaQuery: MediaQueryList | null = null;
function canSeeNavItem(item: Pick<NavItem, 'client' | 'roles' | 'internal'>): boolean {
  const roles = auth.identity?.roles ?? [];
  if (item.client) return roles.includes('CLIENT');
  if (item.roles) return item.roles.some((role) => roles.includes(role));
  if (item.internal) return !roles.includes('CLIENT');
  return true;
}

const visibleNavGroups = computed(() => navGroups
  .filter((group) => canSeeNavItem(group))
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeNavItem(item)),
  }))
  .filter((group) => group.items.length > 0));

function toggleUserMenu(): void {
  isUserMenuOpen.value = !isUserMenuOpen.value;
}

function closeUserMenu(): void {
  isUserMenuOpen.value = false;
}

function toggleSidebar(): void {
  isSidebarOpen.value = !isSidebarOpen.value;
}

function closeSidebar(): void {
  isSidebarOpen.value = false;
}

function logout(): void {
  closeUserMenu();
  closeSidebar();
  auth.logout();
  void router.replace('/login');
}

function handleBreakpointChange(event: MediaQueryListEvent | MediaQueryList): void {
  isNarrowLayout.value = event.matches;
  if (!event.matches) closeSidebar();
}

onMounted(() => {
  sidebarMediaQuery = window.matchMedia('(max-width: 1023px)');
  handleBreakpointChange(sidebarMediaQuery);
  sidebarMediaQuery.addEventListener('change', handleBreakpointChange);
});

onBeforeUnmount(() => {
  sidebarMediaQuery?.removeEventListener('change', handleBreakpointChange);
});

watch(() => route.fullPath, () => {
  closeUserMenu();
  if (isNarrowLayout.value) closeSidebar();
});
</script>

<template>
  <div class="app-layout">
    <header class="app-layout__topbar">
      <div class="app-layout__topbar-start">
        <button
          class="app-layout__sidebar-toggle"
          type="button"
          :aria-label="isSidebarOpen ? 'Close navigation' : 'Open navigation'"
          :aria-expanded="isSidebarOpen"
          aria-controls="primary-sidebar"
          @click="toggleSidebar"
        >
          <span :class="isSidebarOpen ? 'pi pi-times' : 'pi pi-bars'" aria-hidden="true" />
        </button>

        <RouterLink class="app-layout__brand" to="/" aria-label="MarineX360 home">
          <span class="app-layout__brand-mark" aria-hidden="true">TKMR</span>
          <span class="app-layout__brand-name">MarineX360</span>
        </RouterLink>
      </div>

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
      <aside
        id="primary-sidebar"
        class="app-layout__sidebar"
        :class="{ 'app-layout__sidebar--open': isSidebarOpen }"
        aria-label="Primary"
      >
        <nav class="app-layout__nav">
          <section v-for="group in visibleNavGroups" :key="group.label" class="app-layout__nav-group">
            <p class="app-layout__nav-group-label">
              <span>{{ group.label }}</span>
            </p>
            <RouterLink
              v-for="item in group.items"
              :key="item.label"
              class="app-layout__nav-item"
              :to="item.to"
              @click="closeSidebar"
            >
              <span :class="item.icon" aria-hidden="true" />
              <span>{{ item.label }}</span>
            </RouterLink>
          </section>
        </nav>
      </aside>

      <section class="app-layout__content" aria-label="Workspace">
        <RouterView />
      </section>
    </div>

    <button
      v-if="isNarrowLayout && isSidebarOpen"
      class="app-layout__backdrop"
      type="button"
      aria-label="Close navigation"
      @click="closeSidebar"
    />
  </div>
</template>
