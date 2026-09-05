import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import MobileShell from '@/layouts/MobileShell.vue';
import AssignedJobsList from '@/views/AssignedJobsList.vue';
import ChecklistExecution from '@/views/ChecklistExecution.vue';
import Dashboard from '@/views/Dashboard.vue';
import ExecutionSummaryView from '@/views/ExecutionSummaryView.vue';
import JobDetail from '@/views/JobDetail.vue';
import JobDocumentsList from '@/views/JobDocumentsList.vue';
import Login from '@/views/Login.vue';
import MaterialLineForm from '@/views/MaterialLineForm.vue';
import ObservationForm from '@/views/ObservationForm.vue';
import Profile from '@/views/Profile.vue';
import SignatureCapture from '@/views/SignatureCapture.vue';
import SyncStatusPanel from '@/components/SyncStatusPanel.vue';
import { useAuth } from '@/composables/useAuth';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
  }
}

const routes = [
  {
    path: '/login',
    name: 'login',
    component: Login,
    meta: { public: true },
  },
  {
    path: '/',
    component: MobileShell,
    children: [
      {
        path: '',
        redirect: '/jobs',
      },
      {
        path: 'jobs',
        name: 'assigned-jobs',
        component: AssignedJobsList,
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: Dashboard,
      },
      {
        path: 'profile',
        name: 'profile',
        component: Profile,
      },
      {
        path: 'sync',
        name: 'sync',
        component: SyncStatusPanel,
      },
      {
        path: 'jobs/:id',
        name: 'job-detail',
        component: JobDetail,
      },
      {
        path: 'jobs/:id/checklist',
        name: 'job-checklist',
        component: ChecklistExecution,
      },
      {
        path: 'jobs/:id/materials',
        name: 'job-materials',
        component: MaterialLineForm,
      },
      {
        path: 'jobs/:id/observations',
        name: 'job-observations',
        component: ObservationForm,
      },
      {
        path: 'jobs/:id/documents',
        name: 'job-documents',
        component: JobDocumentsList,
      },
      {
        path: 'jobs/:id/sign',
        name: 'job-signature',
        component: SignatureCapture,
      },
      {
        path: 'jobs/:id/completion-preview',
        name: 'job-completion-preview',
        component: ExecutionSummaryView,
      },
      {
        path: 'jobs/:id/completion-report',
        name: 'job-completion-report',
        component: ExecutionSummaryView,
      },
    ],
  },
] satisfies RouteRecordRaw[];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach(async (to) => {
  const session = await useAuth().currentSession();

  if (!to.meta.public && !session) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  if (to.meta.public && session && to.path === '/login') {
    return '/jobs';
  }

  return true;
});
