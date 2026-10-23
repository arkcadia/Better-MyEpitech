import { fetch as expoFetch } from 'expo/fetch';
import { DeviceDocuments } from './src/features/documents/DeviceDocuments';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { SessionManager, type SessionStatus } from './src/application/sessionManager';
import { PortalSignIn } from './src/features/auth/PortalSignIn';
import { SchoolOverview } from './src/features/school/SchoolOverview';
import { HttpEpitechAuthApi } from './src/providers/epitech/api';
import { SecureSessionVault } from './src/storage/secureSessionVault';

const labels: Record<SessionStatus, string> = {
  disconnected: 'Not connected',
  restoring: 'Restoring your connection',
  connecting: 'Verifying your student account',
  checking: 'Checking your connection',
  refreshing: 'Renewing your connection',
  connected: 'Connected to Epitech',
  disconnecting: 'Removing your saved connection',
  reauthentication_required: 'Sign in again to reconnect',
  error: 'Your connection needs attention',
};

function LoginApp() {
  const [session] = useState(() => new SessionManager(new HttpEpitechAuthApi(undefined, 20_000, expoFetch as typeof fetch), new SecureSessionVault()));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [portalOpen, setPortalOpen] = useState(false);
  const busy = ['restoring', 'connecting', 'checking', 'refreshing', 'disconnecting'].includes(snapshot.status);

  useEffect(() => {
    void session.restore();
    const listener = AppState.addEventListener('change', state => {
      const current = session.getSnapshot();
      if (state === 'active' && current.status === 'connected' &&
          current.lastVerifiedAt !== null && Date.now() - current.lastVerifiedAt > 30_000) {
        void session.checkConnection();
      }
    });
    return () => {
      listener.remove();
      session.suspend();
    };
  }, [session]);

  if (Platform.OS !== 'android') {
    return <SafeAreaView style={styles.page}><Text style={styles.title}>Android first.</Text><Text style={styles.body}>This login validation app currently targets Android.</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <Text style={styles.eyebrow}>BETTER MYEPITECH</Text>
          <View style={styles.testBadge}><Text style={styles.testBadgeText}>ANDROID · PREVIEW</Text></View>
        </View>
        <View style={styles.intro}>
          <Text style={styles.title}>Your school.{ '\n' }Connected.</Text>
          <Text style={styles.body}>Start with your Epitech account. Your school connection stays on this device.</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.statusRow}>
            {busy ? <ActivityIndicator size="small" color="#2454df" /> : <View style={[styles.dot, snapshot.status === 'connected' && styles.connectedDot]} />}
            <Text accessibilityRole="header" style={styles.status}>{labels[snapshot.status]}</Text>
          </View>
          {snapshot.student ? (
            <View style={styles.identity}>
              <Text style={styles.name}>{snapshot.student.firstName} {snapshot.student.lastName}</Text>
              <Text selectable style={styles.login}>{snapshot.student.login}</Text>
              {snapshot.student.campus ? <Text style={styles.detail}>{snapshot.student.campus}</Text> : null}
              {snapshot.lastVerifiedAt ? <Text style={styles.detail}>Last checked at {new Date(snapshot.lastVerifiedAt).toLocaleTimeString()}</Text> : null}
              {snapshot.refreshCount > 0 && snapshot.status === 'connected' ? <Text style={styles.success}>Session renewal checked successfully.</Text> : null}
            </View>
          ) : (
            <Text style={styles.description}>Use your normal school sign-in, including any Microsoft verification your account requires.</Text>
          )}
          {snapshot.issue ? <Text accessibilityRole="alert" style={styles.error}>{snapshot.issue.message}</Text> : null}
          {snapshot.status !== 'connected' && !busy ? (
            <Action label="Connect Epitech" onPress={() => setPortalOpen(true)} />
          ) : null}
          {snapshot.status === 'connected' ? (
            <>
              <Action label="Check connection" onPress={() => void session.checkConnection()} />
              <Action label="Renew connection" secondary onPress={() => void session.checkConnection(true)} />
            </>
          ) : null}
          {snapshot.status === 'error' ? <Action label="Retry saved connection" secondary onPress={() => void session.checkConnection()} /> : null}
          {snapshot.status !== 'disconnected' ? <Action label="Disconnect from this device" secondary disabled={snapshot.status === 'disconnecting'} onPress={() => void session.disconnect()} /> : null}
          {busy ? <Text accessibilityLiveRegion="polite" style={styles.detail}>Please wait…</Text> : null}
        </View>
        {snapshot.student && ['connected', 'checking', 'refreshing'].includes(snapshot.status) ? <><SchoolOverview session={session} login={snapshot.student.login} /><DeviceDocuments session={session} login={snapshot.student.login} /></> : null}
        <View style={styles.note}>
          <Text style={styles.noteTitle}>Keep your dates together</Text>
          <Text style={styles.noteBody}>Browse accessible projects and timetable entries, then choose which dates to add to Google Calendar. Google connection is optional; school information stays on this device.</Text>
        </View>
        <Text style={styles.footer}>Independent student project · No school affiliation</Text>
      </ScrollView>
      {portalOpen ? <PortalSignIn session={session} onClose={() => setPortalOpen(false)} /> : null}
    </SafeAreaView>
  );
}

function Action({ label, onPress, secondary = false, disabled = false }: { label: string; onPress(): void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  return <SafeAreaProvider><LoginApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7fc' },
  content: { flexGrow: 1, padding: 24, gap: 28, maxWidth: 580, width: '100%', alignSelf: 'center' },
  brand: { marginTop: 8, gap: 12 },
  eyebrow: { fontSize: 14, color: '#17233a', fontWeight: '800', letterSpacing: 1.8 },
  testBadge: { alignSelf: 'flex-start', backgroundColor: '#e7edff', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 9 },
  testBadgeText: { fontSize: 10, color: '#3658b7', fontWeight: '700', letterSpacing: 1.2 },
  intro: { gap: 16, marginTop: 16 },
  title: { color: '#17233a', fontSize: 44, lineHeight: 49, fontWeight: '800', letterSpacing: -1.5 },
  body: { color: '#58667e', fontSize: 16, lineHeight: 25 },
  card: { borderWidth: 1, borderColor: '#e0e6f0', borderRadius: 20, padding: 22, backgroundColor: '#fff', gap: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#a7b0c1' },
  connectedDot: { backgroundColor: '#208362' },
  status: { flex: 1, color: '#26334c', fontSize: 15, fontWeight: '700' },
  identity: { gap: 7, paddingVertical: 8 },
  name: { color: '#17233a', fontSize: 24, fontWeight: '700' },
  login: { color: '#44536e', fontSize: 14 },
  detail: { color: '#718098', fontSize: 12, lineHeight: 19 },
  description: { color: '#58667e', fontSize: 14, lineHeight: 22 },
  error: { color: '#923a25', backgroundColor: '#fff3ed', padding: 12, borderRadius: 8, fontSize: 14, lineHeight: 21 },
  success: { color: '#208362', fontSize: 13, lineHeight: 20 },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 11, backgroundColor: '#2454df' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { backgroundColor: '#eef2fc' },
  secondaryButtonText: { color: '#3658a3' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  note: { paddingHorizontal: 4, gap: 8 },
  noteTitle: { fontSize: 14, fontWeight: '700', color: '#4b5b76' },
  noteBody: { fontSize: 13, lineHeight: 21, color: '#718098' },
  footer: { marginTop: 'auto', textAlign: 'center', fontSize: 11, color: '#8b96a8', paddingTop: 8 },
});
