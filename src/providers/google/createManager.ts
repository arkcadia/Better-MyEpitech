import * as Crypto from 'expo-crypto';
import { CalendarExportManager } from '../../application/calendarExport';
import { AndroidGoogleAuthorization } from './authorization';
import { GoogleCalendarHttpApi } from './api';
import { SecureGoogleCalendarVault } from './vault';

export function createGoogleCalendarManager() {
  const digest = (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  return new CalendarExportManager({
    authorization: new AndroidGoogleAuthorization(process.env.EXPO_PUBLIC_GOOGLE_CALENDAR_ENABLED === 'true'),
    api: new GoogleCalendarHttpApi(), vault: new SecureGoogleCalendarVault(digest), digest,
  });
}
