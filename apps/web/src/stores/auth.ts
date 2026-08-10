import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { post } from '@/lib/api/client';
import {
  type AuthSession,
  authSessionChangedEvent,
  clearAuthTokens,
  getAuthSession,
  setAuthSession,
} from '@/lib/api/session';

export interface AuthIdentity {
  userId: string;
  name?: string;
  roles: string[];
  branch: string;
}

interface AccessClaims {
  sub: string;
  roles: string[];
  branch: string;
  mfaComplete?: boolean;
  iat: number;
  exp: number;
}

interface LoginRequest {
  email: string;
  password: string;
  totp?: string;
  longLived?: boolean;
}

interface LoginResponse {
  access: string;
  refresh: string;
  mfaEnrollmentRequired: boolean;
}

interface RefreshResponse {
  access: string;
  refresh: string;
}

interface RecoveryLoginRequest {
  email: string;
  code: string;
  longLived?: boolean;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

function decodeAccessClaims(access: string): AccessClaims | null {
  const [, body] = access.split('.');
  if (!body) return null;

  try {
    const claims = JSON.parse(decodeBase64Url(body)) as Partial<AccessClaims>;
    if (typeof claims.sub !== 'string' || !Array.isArray(claims.roles) || typeof claims.branch !== 'string') {
      return null;
    }

    return {
      sub: claims.sub,
      roles: claims.roles.filter((role): role is string => typeof role === 'string'),
      branch: claims.branch,
      mfaComplete: claims.mfaComplete,
      iat: typeof claims.iat === 'number' ? claims.iat : 0,
      exp: typeof claims.exp === 'number' ? claims.exp : 0,
    };
  } catch {
    return null;
  }
}

function identityFromAccess(access: string): AuthIdentity | null {
  const claims = decodeAccessClaims(access);
  if (!claims) return null;

  return {
    userId: claims.sub,
    roles: claims.roles,
    branch: claims.branch,
  };
}

export const useAuthStore = defineStore('auth', () => {
  const persisted = getAuthSession();
  const access = ref<string | null>(persisted?.access ?? null);
  const refreshToken = ref<string | null>(persisted?.refresh ?? null);
  const identity = ref<AuthIdentity | null>(access.value ? identityFromAccess(access.value) : null);
  const mfaEnrollmentRequired = ref(persisted?.mfaEnrollmentRequired ?? false);

  const isAuthenticated = computed(() => Boolean(access.value && refreshToken.value && identity.value));

  function applySession(nextAccess: string, nextRefresh: string, nextMfaEnrollmentRequired = mfaEnrollmentRequired.value): void {
    access.value = nextAccess;
    refreshToken.value = nextRefresh;
    identity.value = identityFromAccess(nextAccess);
    mfaEnrollmentRequired.value = nextMfaEnrollmentRequired;
    setAuthSession({
      access: nextAccess,
      refresh: nextRefresh,
      mfaEnrollmentRequired: nextMfaEnrollmentRequired,
    });
  }

  async function login(payload: LoginRequest): Promise<void> {
    const response = await post<LoginResponse, LoginRequest>('/auth/login', payload, {
      skipAuth: true,
      retryOnUnauthorized: false,
    });

    applySession(response.access, response.refresh, response.mfaEnrollmentRequired);
  }

  async function refresh(): Promise<void> {
    if (!refreshToken.value) return logout();

    const response = await post<RefreshResponse, { refresh: string }>('/auth/refresh', { refresh: refreshToken.value }, {
      skipAuth: true,
      retryOnUnauthorized: false,
    });

    applySession(response.access, response.refresh);
  }

  async function completeMfaEnrollment(): Promise<void> {
    await refresh();
    if (!access.value || !refreshToken.value) return;
    applySession(access.value, refreshToken.value, false);
  }

  async function recoverWithCode(payload: RecoveryLoginRequest): Promise<void> {
    const response = await post<RefreshResponse, RecoveryLoginRequest>('/auth/totp/recovery/verify', payload, {
      skipAuth: true,
      retryOnUnauthorized: false,
    });

    applySession(response.access, response.refresh, false);
  }

  function logout(): void {
    access.value = null;
    refreshToken.value = null;
    identity.value = null;
    mfaEnrollmentRequired.value = false;
    clearAuthTokens();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(authSessionChangedEvent, (event) => {
      const session = (event as CustomEvent<AuthSession | null>).detail;
      access.value = session?.access ?? null;
      refreshToken.value = session?.refresh ?? null;
      identity.value = session?.access ? identityFromAccess(session.access) : null;
      mfaEnrollmentRequired.value = session?.mfaEnrollmentRequired ?? false;
    });
  }

  return {
    access,
    refresh: refreshToken,
    identity,
    mfaEnrollmentRequired,
    isAuthenticated,
    login,
    refreshSession: refresh,
    completeMfaEnrollment,
    recoverWithCode,
    logout,
  };
});
