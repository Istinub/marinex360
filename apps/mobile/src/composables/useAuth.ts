import { Preferences } from '@capacitor/preferences';
import { apiBase } from './useOfflineExecution.ts';

const SESSION_KEY = 'marinex360.auth.session';

export interface MobileSession {
  access: string;
  refresh: string;
  userId: string;
  roles: string[];
  branch: string;
}

export interface LoginResult extends MobileSession {
  mfaEnrollmentRequired: boolean;
}

interface AccessClaims {
  sub: string;
  roles: string[];
  branch: string;
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

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export type LoginErrorKind = 'credentials' | 'totp-required' | 'totp-invalid' | 'network' | 'request';

export class LoginError extends Error {
  readonly kind: LoginErrorKind;

  constructor(kind: LoginErrorKind, message: string) {
    super(message);
    this.name = 'LoginError';
    this.kind = kind;
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

let cachedSession: MobileSession | null = null;
let refreshInFlight: Promise<MobileSession> | null = null;

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return globalThis.atob(padded);
}

function decodeAccessClaims(access: string): AccessClaims {
  const [, payload] = access.split('.');
  if (!payload) throw new Error('Access token payload is missing.');

  let claims: unknown;
  try {
    claims = JSON.parse(decodeBase64Url(payload));
  } catch {
    throw new Error('Access token payload is invalid.');
  }

  if (!claims || typeof claims !== 'object') throw new Error('Access token claims are invalid.');
  const record = claims as Record<string, unknown>;
  if (typeof record.sub !== 'string' || typeof record.branch !== 'string' || !Array.isArray(record.roles)) {
    throw new Error('Access token identity claims are invalid.');
  }

  const roles = record.roles.filter((role): role is string => typeof role === 'string');
  if (roles.length !== record.roles.length) throw new Error('Access token roles claim is invalid.');

  return { sub: record.sub, roles, branch: record.branch };
}

function isMobileSession(value: unknown): value is MobileSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<MobileSession>;
  return typeof session.access === 'string'
    && typeof session.refresh === 'string'
    && typeof session.userId === 'string'
    && Array.isArray(session.roles)
    && session.roles.every((role) => typeof role === 'string')
    && typeof session.branch === 'string';
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function apiError(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as ApiErrorEnvelope).error;
  if (typeof error?.code !== 'string' || typeof error.message !== 'string') return null;
  return { code: error.code, message: error.message };
}

async function persistSession(session: MobileSession): Promise<void> {
  await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) });
  cachedSession = session;
}

function sessionFromAccess(access: string, refresh: string): MobileSession {
  const claims = decodeAccessClaims(access);
  return {
    access,
    refresh,
    userId: claims.sub,
    roles: claims.roles,
    branch: claims.branch,
  };
}

export async function currentSession(): Promise<MobileSession | null> {
  const stored = await Preferences.get({ key: SESSION_KEY });
  if (!stored.value) {
    cachedSession = null;
    return null;
  }

  try {
    const session = JSON.parse(stored.value) as unknown;
    if (!isMobileSession(session)) throw new Error('Stored session shape is invalid.');

    const claims = decodeAccessClaims(session.access);
    if (claims.sub !== session.userId || claims.branch !== session.branch) {
      throw new Error('Stored session identity does not match its access token.');
    }

    cachedSession = session;
    return session;
  } catch {
    await Preferences.remove({ key: SESSION_KEY });
    cachedSession = null;
    return null;
  }
}

export function currentSessionSnapshot(): MobileSession | null {
  return cachedSession;
}

export async function login(
  email: string,
  password: string,
  totp?: string,
  longLived = true,
): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim(),
        password,
        ...(totp ? { totp: totp.trim() } : {}),
        longLived,
      }),
    });
  } catch {
    throw new LoginError('network', 'Unable to reach the server. Check your connection and try again.');
  }

  const body = await parseResponseBody(response);
  if (!response.ok) {
    const error = apiError(body);
    if (response.status === 401 && error?.message.includes('valid TOTP required')) {
      throw new LoginError(totp ? 'totp-invalid' : 'totp-required', error.message);
    }
    if (response.status === 401 && error?.message === 'invalid credentials') {
      throw new LoginError('credentials', error.message);
    }
    throw new LoginError('request', error?.message ?? `Sign in failed (${response.status}).`);
  }

  const result = body as Partial<LoginResponse>;
  if (typeof result.access !== 'string'
    || typeof result.refresh !== 'string'
    || typeof result.mfaEnrollmentRequired !== 'boolean') {
    throw new LoginError('request', 'The server returned an invalid login response.');
  }

  const session = sessionFromAccess(result.access, result.refresh);
  await persistSession(session);
  return { ...session, mfaEnrollmentRequired: result.mfaEnrollmentRequired };
}

async function performRefresh(): Promise<MobileSession> {
  const session = await currentSession();
  if (!session?.refresh) {
    await logout();
    throw new SessionExpiredError();
  }

  try {
    const response = await fetch(`${apiBase()}/auth/refresh`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh: session.refresh, longLived: true }),
    });
    const body = await parseResponseBody(response);
    if (!response.ok) throw new Error(apiError(body)?.message ?? `Refresh failed (${response.status}).`);

    const result = body as Partial<RefreshResponse>;
    if (typeof result.access !== 'string' || typeof result.refresh !== 'string') {
      throw new Error('The server returned an invalid refresh response.');
    }

    const nextSession = sessionFromAccess(result.access, result.refresh);
    await persistSession(nextSession);
    return nextSession;
  } catch (error) {
    await logout();
    throw new SessionExpiredError(error instanceof Error ? error.message : undefined);
  }
}

export async function refresh(): Promise<MobileSession> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function logout(): Promise<void> {
  await Preferences.remove({ key: SESSION_KEY });
  cachedSession = null;
}

function isExpiredAccessResponse(response: Response, body: unknown): boolean {
  const error = apiError(body);
  return response.status === 401 && error?.code === 'UNAUTHORIZED' && error.message === 'token expired';
}

async function requestWithSession(input: RequestInfo | URL, init: RequestInit, session: MobileSession): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access}`);
  return fetch(input, { ...init, headers });
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const session = await currentSession();
  if (!session) throw new SessionExpiredError();

  const response = await requestWithSession(input, init, session);
  if (response.status !== 401) return response;

  const body = await parseResponseBody(response.clone());
  if (!isExpiredAccessResponse(response, body)) return response;

  const nextSession = await refresh();
  return requestWithSession(input, init, nextSession);
}

const auth = {
  login,
  refresh,
  logout,
  currentSession,
  authenticatedFetch,
};

export function useAuth() {
  return auth;
}
