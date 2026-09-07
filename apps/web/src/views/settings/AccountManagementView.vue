<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <main class="office-route crm-page" aria-labelledby="account-management-title">
    <header class="crm-page__header">
      <div>
        <p class="crm-page__eyebrow">Settings</p>
        <h1 id="account-management-title" class="crm-page__title">Account Management</h1>
        <p class="record-form__version">Accounts are currently fixed: 3 technician devices plus Operations, Finance, Director, and Admin. Free account registration is a future addition.</p>
      </div>
    </header>

    <section class="settings-link-grid" aria-label="Account management actions">
      <RouterLink class="settings-link-card" to="/settings/account-management/register-account">
        <span class="pi pi-user-plus" aria-hidden="true" />
        <span>
          <strong>Register account</strong>
          <small>Fixed-account model for now</small>
        </span>
      </RouterLink>
      <RouterLink class="settings-link-card" to="/clients/new">
        <span class="pi pi-briefcase" aria-hidden="true" />
        <span>
          <strong>Register client</strong>
          <small>Open existing client form</small>
        </span>
      </RouterLink>
      <RouterLink class="settings-link-card" to="/vessels/new">
        <span class="pi pi-compass" aria-hidden="true" />
        <span>
          <strong>Register vessel</strong>
          <small>Open existing vessel form</small>
        </span>
      </RouterLink>
      <RouterLink class="settings-link-card" to="/settings/account-management/roles-permissions">
        <span class="pi pi-shield" aria-hidden="true" />
        <span>
          <strong>Roles & permissions</strong>
          <small>Coming soon</small>
        </span>
      </RouterLink>
      <RouterLink class="settings-link-card" to="/settings/account-management/groups">
        <span class="pi pi-users" aria-hidden="true" />
        <span>
          <strong>Manage groups</strong>
          <small>Coming soon</small>
        </span>
      </RouterLink>
    </section>
  </main>
</template>
