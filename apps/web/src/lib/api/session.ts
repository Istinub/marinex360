export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface AuthSession extends AuthTokens {
  mfaEnrollmentRequired: boolean;
}

const sessionKey = 'marinex360.auth.session';
export const authSessionChangedEvent = 'marinex360:auth-session-changed';
export const authMfaEnrollmentRequiredForbiddenEvent = 'marinex360:auth-mfa-enrollment-required-forbidden';

let memorySession: AuthSession | null = null;

function emitSessionChanged(session: AuthSession | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AuthSession | null>(authSessionChangedEvent, { detail: session }));
}

function normalizeSession(value: Partial<AuthSession>): AuthSession | null {
  if (typeof value.access === 'string' && typeof value.refresh === 'string') {
    return {
      access: value.access,
      refresh: value.refresh,
      mfaEnrollmentRequired: value.mfaEnrollmentRequired === true,
    };
  }

  return null;
}

function readSessionStorage(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(sessionKey);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<AuthSession>;
    memorySession = normalizeSession(value);
    return memorySession;
  } catch {
    window.sessionStorage.removeItem(sessionKey);
  }

  return null;
}

export function getAuthTokens(): AuthTokens | null {
  const session = getAuthSession();
  if (!session) return null;
  return { access: session.access, refresh: session.refresh };
}

export function getAuthSession(): AuthSession | null {
  return memorySession ?? readSessionStorage();
}

export function setAuthSession(session: AuthSession): void {
  memorySession = session;
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
  }
  emitSessionChanged(session);
}

export function setAuthTokens(tokens: AuthTokens): void {
  const current = getAuthSession();
  setAuthSession({
    ...tokens,
    mfaEnrollmentRequired: current?.mfaEnrollmentRequired ?? false,
  });
}

export function clearAuthTokens(): void {
  memorySession = null;
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(sessionKey);
  }
  emitSessionChanged(null);
}

export function emitMfaEnrollmentRequiredForbidden(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(authMfaEnrollmentRequiredForbiddenEvent));
}
