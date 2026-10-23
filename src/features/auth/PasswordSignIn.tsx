import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SessionManager } from '../../application/sessionManager';

export function PasswordSignIn({ session, busy, disabled }: {
  session: SessionManager; busy: boolean; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { setPassword(''); setEmail(''); }
    });
    return () => listener.remove();
  }, []);
  const submit = () => {
    if (busy || disabled || !email.trim() || !password) return;
    const submittedPassword = password;
    setPassword('');
    void session.connectWithPassword(email, submittedPassword);
  };
  if (!open) return (
    <Pressable accessibilityRole="button" disabled={busy || disabled}
      accessibilityState={{ disabled: busy || disabled }}
      style={[styles.button, (busy || disabled) && styles.disabled]} onPress={() => setOpen(true)}>
      <Text style={styles.buttonText}>Use email and password</Text>
    </Pressable>
  );
  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" style={styles.title}>Email and password</Text>
      <Text style={styles.body}>For accounts enabled for MyEpitech’s external email/password sign-in.
        Microsoft-only accounts must use the school sign-in. Student access is verified after sign-in.</Text>
      <Text style={styles.label}>Email</Text>
      <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
        autoComplete="username" maxLength={254} editable={!busy && !disabled} style={styles.input} />
      <Text style={styles.label}>Password</Text>
      <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword}
        secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password"
        maxLength={4096} editable={!busy && !disabled} style={styles.input}
        onSubmitEditing={submit} returnKeyType="go" />
      <Pressable accessibilityRole="button" onPress={submit}
        disabled={busy || disabled || !email.trim() || !password}
        accessibilityState={{ disabled: busy || disabled || !email.trim() || !password }}
        style={[styles.button, (busy || disabled || !email.trim() || !password) && styles.disabled]}>
        <Text style={styles.buttonText}>Sign in with email</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} style={styles.button} onPress={() => {
        setPassword(''); setEmail(''); setOpen(false);
        if (busy) void session.disconnect();
      }}><Text style={styles.buttonText}>Cancel email sign-in</Text></Pressable>
      <Text style={styles.body}>Your password goes directly to MyEpitech over HTTPS. This app does not save it.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: 12, borderTopWidth: 1, borderColor: '#e0e6f0', paddingTop: 16 },
  title: { color: '#26334c', fontSize: 16, fontWeight: '700' },
  body: { color: '#58667e', fontSize: 13, lineHeight: 21 },
  label: { color: '#26334c', fontSize: 14, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#b8c4d8', borderRadius: 8, padding: 12, fontSize: 16, color: '#17233a' },
  button: { minHeight: 48, padding: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eef2fc' },
  buttonText: { color: '#3658a3', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
