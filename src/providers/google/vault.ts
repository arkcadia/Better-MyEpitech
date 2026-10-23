import * as SecureStore from 'expo-secure-store';
import { GoogleCalendarError, type AppCalendarState, type GoogleAccount, type GoogleCalendarVault } from '../../domain/googleCalendar';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainService: 'better-myepitech.google', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export class SecureGoogleCalendarVault implements GoogleCalendarVault {
  constructor(private readonly digest: (value: string) => Promise<string>) {}
  private async read(key: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await SecureStore.getItemAsync(key, OPTIONS);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch { throw new GoogleCalendarError('storage'); }
  }
  private async save(key: string, value: unknown) {
    try { await SecureStore.setItemAsync(key, JSON.stringify(value), OPTIONS); }
    catch { throw new GoogleCalendarError('storage'); }
  }
  async selected(schoolLogin: string): Promise<GoogleAccount | null> {
    const value = await this.read(`google.selected.${await this.digest(schoolLogin)}`);
    if (!value) return null;
    if (typeof value.id !== 'string' || !value.id || value.id.length > 255 || typeof value.email !== 'string' || !value.email || value.email.length > 320) throw new GoogleCalendarError('storage');
    return { id: value.id, email: value.email };
  }
  async select(schoolLogin: string, account: GoogleAccount | null) {
    const key = `google.selected.${await this.digest(schoolLogin)}`;
    if (account) await this.save(key, account);
    else { try { await SecureStore.deleteItemAsync(key, OPTIONS); } catch { throw new GoogleCalendarError('storage'); } }
  }
  async calendar(key: string): Promise<AppCalendarState | null> {
    const value = await this.read(`google.calendar.${key}`);
    if (!value) return null;
    if (Object.keys(value).length === 0) return {};
    if (typeof value.calendarId === 'string' && value.calendarId && value.calendarId !== 'primary' && value.calendarId.length <= 2048) return { calendarId: value.calendarId };
    if (value.creationPending === true) return { creationPending: true };
    throw new GoogleCalendarError('storage');
  }
  saveCalendar(key: string, value: AppCalendarState) { return this.save(`google.calendar.${key}`, value); }
}
