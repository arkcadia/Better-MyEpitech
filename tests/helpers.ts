import { vi } from 'vitest';

import { type Credentials, type EpitechAuthApi, type SessionVault, type StoredSession, type VerifiedStudent } from '../src/domain/auth';

// Synthetic fixtures; never copy a real student's session into tests.
export const credentials: Credentials = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
export const renewed: Credentials = { accessToken: 'synthetic-access-2', refreshToken: 'synthetic-refresh-2' };
export const student: VerifiedStudent = { login: 'student@example.invalid', firstName: 'Test', lastName: 'Student', campus: 'Test campus' };
export const stored: StoredSession = { version: 1, credentials, login: student.login };

export class MemoryVault implements SessionVault {
  value: StoredSession | null = null;
  writes: StoredSession[] = [];
  read = vi.fn(async () => this.value);
  write = vi.fn(async (value: StoredSession) => {
    this.value = structuredClone(value);
    this.writes.push(structuredClone(value));
  });
  clear = vi.fn(async () => { this.value = null; });
}

export function fakeApi() {
  return {
    verify: vi.fn<EpitechAuthApi['verify']>().mockResolvedValue({ login: student.login, roles: ['student'] }),
    ownProfile: vi.fn<EpitechAuthApi['ownProfile']>().mockResolvedValue(student),
    refresh: vi.fn<EpitechAuthApi['refresh']>().mockResolvedValue(renewed),
    readSchool: vi.fn<EpitechAuthApi['readSchool']>().mockResolvedValue({}),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
