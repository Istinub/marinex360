import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import MobileShell from '@/layouts/MobileShell.vue';
import AssignedJobsList from '@/views/AssignedJobsList.vue';
import JobDetail from '@/views/JobDetail.vue';
import JobDocumentsList from '@/views/JobDocumentsList.vue';
import MaterialLineForm from '@/views/MaterialLineForm.vue';

const routes = [
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
        path: 'jobs/:id',
        name: 'job-detail',
        component: JobDetail,
      },
      {
        path: 'jobs/:id/materials',
        name: 'job-materials',
        component: MaterialLineForm,
      },
      {
        path: 'jobs/:id/documents',
        name: 'job-documents',
        component: JobDocumentsList,
      },
    ],
  },
] satisfies RouteRecordRaw[];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
