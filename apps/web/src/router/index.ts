import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import AppLayout from '@/layouts/AppLayout.vue';
import { authMfaEnrollmentRequiredForbiddenEvent } from '@/lib/api/session';
import { useAuthStore } from '@/stores/auth';
import LoginView from '@/views/auth/LoginView.vue';
import MfaEnrollView from '@/views/auth/MfaEnrollView.vue';
import MfaRecoveryView from '@/views/auth/MfaRecoveryView.vue';
import ClientDetailView from '@/views/clients/ClientDetailView.vue';
import ClientFormView from '@/views/clients/ClientFormView.vue';
import ClientListView from '@/views/clients/ClientListView.vue';
import ContactEditView from '@/views/contacts/ContactEditView.vue';
import DashboardView from '@/views/dashboard/DashboardView.vue';
import JobOrderDetailView from '@/views/job-orders/JobOrderDetailView.vue';
import JobOrderFormView from '@/views/job-orders/JobOrderFormView.vue';
import JobOrderLifecycleListView from '@/views/job-orders/JobOrderLifecycleListView.vue';
import JobOrderListView from '@/views/job-orders/JobOrderListView.vue';
import VesselFormView from '@/views/vessels/VesselFormView.vue';
import VesselListView from '@/views/vessels/VesselListView.vue';
import VesselServiceHistoryView from '@/views/vessels/VesselServiceHistoryView.vue';
import ServiceRequestView from '@/views/public/ServiceRequestView.vue';
import ClientDashboardView from '@/views/client/ClientDashboardView.vue';
import AnalyticsView from '@/views/analytics/AnalyticsView.vue';
import JobRequestDetailView from '@/views/job-requests/JobRequestDetailView.vue';
import JobRequestQueueView from '@/views/job-requests/JobRequestQueueView.vue';
import ReportsView from '@/views/reports/ReportsView.vue';
import AccountManagementView from '@/views/settings/AccountManagementView.vue';
import DeviceTroubleshootingView from '@/views/settings/DeviceTroubleshootingView.vue';
import DevicesView from '@/views/settings/DevicesView.vue';
import JobExecutionSettingsView from '@/views/settings/JobExecutionSettingsView.vue';
import PlaceholderSettingsView from '@/views/settings/PlaceholderSettingsView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    requireAuth?: boolean;
    requireMfaEnrolled?: boolean;
    roles?: string[];
    lifecycleBucket?: 'trash' | 'archive';
  }
}

const routes = [
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    meta: { public: true },
  },
  {
    path: '/mfa/recovery',
    name: 'mfa-recovery',
    component: MfaRecoveryView,
    meta: { public: true },
  },
  {
    path: '/request-service',
    name: 'public-service-request',
    component: ServiceRequestView,
    meta: { public: true },
  },
  {
    path: '/',
    component: AppLayout,
    meta: { requireAuth: true },
    children: [
      {
        path: '',
        redirect: '/dashboard',
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: DashboardView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'client-dashboard',
        name: 'client-dashboard',
        component: ClientDashboardView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['CLIENT'] },
      },
      {
        path: 'reports',
        name: 'reports',
        component: ReportsView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'analytics',
        name: 'analytics',
        component: AnalyticsView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'job-requests',
        name: 'job-requests',
        component: JobRequestQueueView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['OPS_SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'] },
      },
      {
        path: 'job-requests/:id',
        name: 'job-request-detail',
        component: JobRequestDetailView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['OPS_SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'] },
      },
      {
        path: 'clients',
        name: 'clients',
        component: ClientListView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'clients/new',
        name: 'client-new',
        component: ClientFormView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'clients/:id',
        name: 'client-detail',
        component: ClientDetailView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'clients/:id/edit',
        name: 'client-edit',
        component: ClientFormView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'contacts/:id/edit',
        name: 'contact-edit',
        component: ContactEditView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'job-orders',
        name: 'job-orders',
        component: JobOrderListView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'job-orders/trash',
        name: 'job-orders-trash',
        component: JobOrderLifecycleListView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'], lifecycleBucket: 'trash' },
      },
      {
        path: 'job-orders/archive',
        name: 'job-orders-archive',
        component: JobOrderLifecycleListView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'], lifecycleBucket: 'archive' },
      },
      {
        path: 'job-orders/new',
        name: 'job-order-new',
        component: JobOrderFormView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR', 'OPS_SUPERVISOR'] },
      },
      {
        path: 'job-orders/:id',
        name: 'job-order-detail',
        component: JobOrderDetailView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'vessels',
        name: 'vessels',
        component: VesselListView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'vessels/new',
        name: 'vessel-new',
        component: VesselFormView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'vessels/:id/job-orders',
        name: 'vessel-service-history',
        component: VesselServiceHistoryView,
        meta: { requireAuth: true, requireMfaEnrolled: true },
      },
      {
        path: 'mfa/enroll',
        name: 'mfa-enroll',
        component: MfaEnrollView,
        meta: { requireAuth: true },
      },
      {
        path: 'settings/devices',
        name: 'settings-devices',
        component: DevicesView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      },
      {
        path: 'settings/account-management',
        name: 'settings-account-management',
        component: AccountManagementView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      },
      {
        path: 'settings/account-management/register-account',
        name: 'settings-register-account',
        component: PlaceholderSettingsView,
        props: {
          eyebrow: 'Account Management',
          title: 'Register account — coming soon',
          description: 'User creation is deferred to the account-management pass.',
        },
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      },
      {
        path: 'settings/account-management/roles-permissions',
        name: 'settings-roles-permissions',
        component: PlaceholderSettingsView,
        props: {
          eyebrow: 'Account Management',
          title: 'Roles & permissions — coming soon',
          description: 'Role and permission template editing is deferred to P3-11.',
        },
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      },
      {
        path: 'settings/account-management/groups',
        name: 'settings-groups',
        component: PlaceholderSettingsView,
        props: {
          eyebrow: 'Account Management',
          title: 'Manage groups — coming soon',
          description: 'Group administration will be added in a later settings pass.',
        },
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      },
      {
        path: 'settings/job-execution',
        name: 'settings-job-execution',
        component: JobExecutionSettingsView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN', 'DIRECTOR'] },
      },
      {
        path: 'app-settings/device-troubleshooting',
        name: 'app-settings-device-troubleshooting',
        component: DeviceTroubleshootingView,
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN'] },
      },
      {
        path: 'app-settings/error-log',
        name: 'app-settings-error-log',
        component: PlaceholderSettingsView,
        props: {
          eyebrow: 'App Settings',
          title: 'Error log — coming soon',
          description: 'The ErrorLog viewer is deferred; no log browsing is wired in this pass.',
        },
        meta: { requireAuth: true, requireMfaEnrolled: true, roles: ['SYSTEM_ADMIN'] },
      },
    ],
  },
] satisfies RouteRecordRaw[];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();

  if (to.meta.public && auth.isAuthenticated && to.path === '/login') {
    return auth.mfaEnrollmentRequired ? '/mfa/enroll' : '/dashboard';
  }

  if (to.meta.requireAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  if (to.meta.requireMfaEnrolled && auth.mfaEnrollmentRequired) {
    return '/mfa/enroll';
  }

  if (to.meta.roles && !to.meta.roles.some((role) => auth.identity?.roles.includes(role))) {
    return auth.identity?.roles.includes('CLIENT') ? '/client-dashboard' : '/dashboard';
  }

  if (auth.identity?.roles.includes('CLIENT') && to.path !== '/client-dashboard' && to.path !== '/request-service') {
    return '/client-dashboard';
  }

  return true;
});

if (typeof window !== 'undefined') {
  window.addEventListener(authMfaEnrollmentRequiredForbiddenEvent, () => {
    const auth = useAuthStore();
    if (auth.mfaEnrollmentRequired && router.currentRoute.value.path !== '/mfa/enroll') {
      void router.push('/mfa/enroll');
    }
  });
}
