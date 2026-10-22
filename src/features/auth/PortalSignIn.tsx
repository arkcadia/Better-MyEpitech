import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { type SessionManager } from '../../application/sessionManager';
import { PORTAL_URL } from '../../providers/epitech/api';
import { isAllowedSignInUrl, isPortalUrl, PortalTransferGate } from '../../providers/epitech/portalBridge';

interface Props {
  session: SessionManager;
  onClose(): void;
}

export function PortalSignIn({ session, onClose }: Props) {
  const webView = useRef<WebView<unknown>>(null);
  const active = useRef(true);
  const gate = useRef(new PortalTransferGate());
  const currentUrl = useRef(PORTAL_URL);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [url, setUrl] = useState(PORTAL_URL);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [received, setReceived] = useState(false);
  const receivedRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  function clearRequest() {
    gate.current.cancel();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setWaiting(false);
  }

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      gate.current.cancel();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function updateNavigation(next: WebViewNavigation) {
    if (next.url !== currentUrl.current || next.loading) clearRequest();
    currentUrl.current = next.url;
    setUrl(next.url);
    setLoading(next.loading);
  }

  function transfer() {
    if (loading || waiting || receivedRef.current || !isPortalUrl(currentUrl.current)) return;
    setNotice(null);
    setWaiting(true);
    const script = gate.current.begin(currentUrl.current, randomUUID(), Date.now());
    // There is no injectedJavaScript/beforeContentLoaded hook. This runs only
    // after this native button is pressed and checks the executing origin again.
    webView.current?.injectJavaScript(script);
    timer.current = setTimeout(() => {
      gate.current.cancel();
      setWaiting(false);
      setNotice('The sign-in window did not respond. Finish signing in, then try again.');
    }, 10_000);
  }

  async function receive(event: WebViewMessageEvent) {
    const result = gate.current.receive(event.nativeEvent.data, event.nativeEvent.url, currentUrl.current, Date.now());
    if (!result) return;
    clearRequest();
    if (result.kind === 'not_ready') {
      setNotice('Finish signing in on the school page, then press Continue.');
      return;
    }
    if (result.kind === 'invalid_session') {
      setNotice('The school session could not be connected. Close this window and try again.');
      return;
    }
    receivedRef.current = true;
    setReceived(true); // Unmount the private portal before native verification.
    webView.current?.stopLoading();
    await session.connectFromPortal(result.credentials);
    if (active.current) onClose();
  }

  async function cancel() {
    if (!active.current) return;
    active.current = false;
    clearRequest();
    if (receivedRef.current) await session.disconnect();
    onClose();
  }

  let host = 'School sign-in';
  try { host = new URL(url).hostname; } catch { /* Never display an authorization URL. */ }

  return (
    <Modal animationType="slide" onRequestClose={() => void cancel()}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title}>School sign-in</Text>
            <Text style={styles.host}>{host}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void cancel()} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={styles.explanation}>Sign in on the official school page. Once your dashboard appears, press Continue to connect this device.</Text>
        {received ? (
          <View style={styles.verifying}><ActivityIndicator color="#2454df" /><Text style={styles.message}>Verifying your student account…</Text></View>
        ) : (
          <WebView<unknown>
            ref={webView}
            source={{ uri: PORTAL_URL }}
            incognito
            cacheEnabled={false}
            cacheMode="LOAD_NO_CACHE"
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            domStorageEnabled
            javaScriptEnabled
            mixedContentMode="never"
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            geolocationEnabled={false}
            saveFormDataDisabled
            webviewDebuggingEnabled={false}
            setSupportMultipleWindows
            onOpenWindow={() => setNotice('This sign-in opened a separate window, which this connection test cannot support yet.')}
            // Route every scheme through our predicate, rather than letting
            // WebView send non-whitelisted URLs to external apps automatically.
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={request => {
              const allowed = isAllowedSignInUrl(request.url);
              if (!allowed) {
                clearRequest();
                setNotice('The school requested a sign-in destination this connection test does not support yet.');
              }
              return allowed;
            }}
            onLoadStart={event => {
              clearRequest();
              currentUrl.current = event.nativeEvent.url;
              setUrl(event.nativeEvent.url);
              setLoading(true);
            }}
            onNavigationStateChange={updateNavigation}
            // Do not install a page-message handler on Microsoft credential pages.
            onMessage={isPortalUrl(url) ? event => void receive(event) : undefined}
            onError={() => {
              setLoading(false);
              clearRequest();
              setNotice('The sign-in page could not load. Check your connection and try again.');
            }}
            onRenderProcessGone={() => {
              clearRequest();
              setNotice('The sign-in window stopped. Close it and start again.');
            }}
            style={styles.webView}
          />
        )}
        <View style={styles.footer}>
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: loading || !isPortalUrl(url) || waiting || received }}
            disabled={loading || !isPortalUrl(url) || waiting || received}
            onPress={transfer}
            style={({ pressed }) => [styles.continue, (loading || !isPortalUrl(url) || waiting || received) && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.continueText}>{waiting ? 'Connecting…' : 'Continue with this school session'}</Text>
          </Pressable>
          <Text style={styles.privacy}>Your school password stays in the official sign-in page. The school session is connected on this device.</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomColor: '#e5e9f0', borderBottomWidth: 1 },
  heading: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: '#17233a' },
  host: { fontSize: 12, color: '#54637a', marginTop: 4 },
  cancel: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  cancelText: { color: '#2454df', fontSize: 15, fontWeight: '600' },
  explanation: { color: '#54637a', fontSize: 13, lineHeight: 19, paddingHorizontal: 20, paddingVertical: 12 },
  webView: { flex: 1 },
  verifying: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  message: { color: '#17233a', fontSize: 16 },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: '#e5e9f0', gap: 12 },
  notice: { color: '#8f381d', lineHeight: 20, fontSize: 14 },
  continue: { backgroundColor: '#2454df', minHeight: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12 },
  continueText: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  privacy: { color: '#6b778a', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
