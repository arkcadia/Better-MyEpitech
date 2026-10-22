import * as SecureStore from 'expo-secure-store';

import { AuthError, parseStoredSession, type SessionVault, type StoredSession } from '../domain/auth';

const KEY = 'better-myepitech.epitech-session.v1';
const options: SecureStore.SecureStoreOptions = { keychainService: 'better-myepitech.epitech' };

export class SecureSessionVault implements SessionVault {
  async read(): Promise<StoredSession | null> {
    let raw: string | null;
    try {
      raw = await SecureStore.getItemAsync(KEY, options);
    } catch {
      throw new AuthError('storage');
    }
    if (raw === null) return null;
    try {
      return parseStoredSession(JSON.parse(raw) as unknown);
    } catch {
      throw new AuthError('contract');
    }
  }

  async write(session: StoredSession): Promise<void> {
    try {
      // One encrypted value keeps the access/refresh pair and its bound account together.
      await SecureStore.setItemAsync(KEY, JSON.stringify(session), options);
    } catch {
      throw new AuthError('storage');
    }
  }

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY, options);
    } catch {
      throw new AuthError('storage');
    }
  }
}
