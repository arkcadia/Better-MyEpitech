export interface Credentials {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface StoredSession {
  readonly version: 1;
  readonly credentials: Credentials;
  readonly login: string;
}

export interface VerifiedStudent {
  readonly login: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly campus: string | null;
}

export interface SessionVault {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export interface SchoolIdentity {
  readonly login: string;
  readonly roles: readonly string[];
}

export interface EpitechAuthApi {
  signInWithPassword?(email: string, password: string, signal: AbortSignal): Promise<Credentials>;
  verify(accessToken: string, signal: AbortSignal): Promise<SchoolIdentity>;
  ownProfile(accessToken: string, signal: AbortSignal): Promise<VerifiedStudent>;
  refresh(credentials: Credentials, signal: AbortSignal): Promise<Credentials>;
  readSchoolFile?(path: string, accessToken: string, signal: AbortSignal): Promise<Response>;
  readSchool(path: string, accessToken: string, signal: AbortSignal): Promise<unknown>;
}

export type AuthErrorCode =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'server'
  | 'contract'
  | 'not_student'
  | 'identity_mismatch'
  | 'storage'
  | 'invalid_credentials'
  | 'invalid_input'
  | 'cancelled';

const messages: Record<AuthErrorCode, string> = {
  network: 'Could not reach Epitech. Check your connection and try again.',
  timeout: 'Epitech took too long to respond. Please try again.',
  unauthorized: 'Your school session has expired. Sign in again to reconnect.',
  forbidden: 'This account cannot access the student profile required by this app.',
  server: 'Epitech is temporarily unavailable. Your saved connection has been kept.',
  contract: 'The school login response has changed or is incomplete. Please reconnect.',
  not_student: 'This app currently supports verified Epitech student accounts.',
  identity_mismatch: 'The school responses do not identify the same student. Please sign in again.',
  storage: 'The session could not be saved or removed securely. Please try again.',
  invalid_credentials: 'MyEpitech rejected external-account sign-in. This does not prove your password is wrong: Microsoft-only accounts may not support this endpoint. Use Microsoft if that is your normal school sign-in.',
  invalid_input: 'Enter a valid email address and a password.',
  cancelled: 'The connection attempt was cancelled.',
};

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, readonly httpStatus?: 400 | 401 | 403) {
    super(`${messages[code]}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    this.name = 'AuthError';
  }
}

export function safeAuthError(error: unknown): AuthError {
  return error instanceof AuthError ? error : new AuthError('network');
}

export const normalizedLogin = (login: string): string => login.trim().toLowerCase();

export function validatePasswordSignIn(email: string, password: string): void {
  if (typeof email !== 'string' || email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !password.length || password.length > 4_096) {
    throw new AuthError('invalid_input');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384 && !/\s/.test(value);
}

export function parseCredentials(value: unknown): Credentials {
  if (!isRecord(value) || !isToken(value.accessToken) || !isToken(value.refreshToken)) {
    throw new AuthError('contract');
  }
  return { accessToken: value.accessToken, refreshToken: value.refreshToken };
}

export function parseStoredSession(value: unknown): StoredSession {
  if (!isRecord(value) || value.version !== 1 || typeof value.login !== 'string' || !value.login.trim()) {
    throw new AuthError('contract');
  }
  return { version: 1, credentials: parseCredentials(value.credentials), login: normalizedLogin(value.login) };
}
