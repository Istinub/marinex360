import {
  ApiResponseError,
  parseApiErrorEnvelope,
  isUnauthorizedError,
  type ApiError,
} from './errors';
import {
  clearAuthTokens,
  emitMfaEnrollmentRequiredForbidden,
  getAuthSession,
  getAuthTokens,
  setAuthTokens,
} from './session';

interface RequestOptions<TBody = unknown> {
  body?: TBody;
  headers?: HeadersInit;
  retryOnUnauthorized?: boolean;
  skipAuth?: boolean;
}

interface RefreshResponse {
  access: string;
  refresh: string;
}

const apiBase = import.meta.env.VITE_API_BASE;

if (apiBase == null || apiBase.trim() === '') {
  throw new Error('VITE_API_BASE must be configured, for example VITE_API_BASE=/api/v1.');
}

let refreshInFlight: Promise<RefreshResponse> | null = null;

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function refreshAccessToken(): Promise<RefreshResponse> {
  const tokens = getAuthTokens();
  if (!tokens?.refresh) {
    clearAuthTokens();
    redirectToLogin();
    throw new ApiResponseError({ code: 'UNAUTHORIZED', message: 'refresh required' }, 401);
  }

  refreshInFlight ??= request<RefreshResponse>('POST', '/auth/refresh', {
    body: { refresh: tokens.refresh },
    skipAuth: true,
    retryOnUnauthorized: false,
  }).finally(() => {
    refreshInFlight = null;
  });

  try {
    const nextTokens = await refreshInFlight;
    setAuthTokens(nextTokens);
    return nextTokens;
  } catch (error) {
    if (isUnauthorizedError(error)) {
      clearAuthTokens();
      redirectToLogin();
    }
    throw error;
  }
}

async function throwApiError(response: Response, body: unknown): Promise<never> {
  const parsed = parseApiErrorEnvelope(body);
  const fallback: ApiError = {
    code: response.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
    message: response.statusText || 'Request failed',
    details: body,
  };

  throw new ApiResponseError(parsed ?? fallback, response.status);
}

async function request<TResponse, TBody = unknown>(
  method: string,
  path: string,
  options: RequestOptions<TBody> = {},
): Promise<TResponse> {
  const headers = new Headers(options.headers);
  const tokens = getAuthTokens();

  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!options.skipAuth && tokens?.access) {
    headers.set('Authorization', `Bearer ${tokens.access}`);
  }

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await parseBody(response);

  if (response.ok) return body as TResponse;

  const parsed = parseApiErrorEnvelope(body);
  const shouldRefresh =
    response.status === 401 &&
    parsed?.code === 'UNAUTHORIZED' &&
    options.retryOnUnauthorized !== false &&
    !options.skipAuth;

  if (shouldRefresh) {
    await refreshAccessToken();
    return request<TResponse, TBody>(method, path, {
      ...options,
      retryOnUnauthorized: false,
    });
  }

  if (parsed?.code === 'FORBIDDEN' && getAuthSession()?.mfaEnrollmentRequired) {
    emitMfaEnrollmentRequiredForbidden();
  }

  return throwApiError(response, body);
}

export function get<TResponse>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<TResponse> {
  return request<TResponse>('GET', path, options);
}

export function post<TResponse, TBody = unknown>(
  path: string,
  body?: TBody,
  options?: Omit<RequestOptions<TBody>, 'body'>,
): Promise<TResponse> {
  return request<TResponse, TBody>('POST', path, { ...options, body });
}

export function patch<TResponse, TBody = unknown>(
  path: string,
  body?: TBody,
  options?: Omit<RequestOptions<TBody>, 'body'>,
): Promise<TResponse> {
  return request<TResponse, TBody>('PATCH', path, { ...options, body });
}
