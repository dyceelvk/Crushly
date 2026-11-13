import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../theme/ThemeProvider';
import {
  CAPTCHA_TIMEOUT_MS,
  captchaEnabled,
  captchaFailureMessage,
  captchaNavigationAllowed,
  captchaPageUrl,
  setCaptchaSolver,
} from '../lib/captcha';

type Pending = { resolve: (token: string) => void; reject: (error: Error) => void };

/**
 * The bot check, on the phone.
 *
 * Cloudflare's widget is a browser script, so it runs in a WebView pointed at
 * `https://holupp.net/captcha.html` — a real hostname, because Turnstile checks
 * the page's domain against the key's allow list and a WebView has no origin of
 * its own.
 *
 * It is a sheet rather than an invisible check on purpose: the person sees that
 * something is being verified, which is the difference between "the app is slow"
 * and "the app is checking". Turnstile usually clears itself in under a second
 * and the sheet closes before it can be read.
 */
export function CaptchaHost() {
  const { colors } = useTheme();
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A reload is a new document with a new Cloudflare session. `key` is how the
  // WebView is thrown away and replaced, because a page that failed to render
  // once (a blocked redirect, a challenge that never answered) does not recover
  // by itself.
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const finish = useCallback(
    (outcome: { token?: string; error?: Error }) => {
      clearTimer();
      setPending((current) => {
        if (!current) return null;
        if (outcome.token) current.resolve(outcome.token);
        else current.reject(outcome.error ?? new Error('The security check failed. Try again.'));
        return null;
      });
      setMessage(null);
    },
    [clearTimer],
  );

  useEffect(() => {
    if (!captchaEnabled()) return;
    setCaptchaSolver(
      () =>
        new Promise<string>((resolve, reject) => {
          setMessage(null);
          setPending({ resolve, reject });
          clearTimer();
          timer.current = setTimeout(() => {
            finish({ error: new Error('The security check took too long. Try again.') });
          }, CAPTCHA_TIMEOUT_MS);
        }),
    );
    return () => {
      setCaptchaSolver(null);
      clearTimer();
    };
  }, [clearTimer, finish]);

  const retry = useCallback(() => {
    setMessage(null);
    clearTimer();
    setAttempt((n) => n + 1);
    if (pending) {
      timer.current = setTimeout(() => {
        finish({ error: new Error('The security check took too long. Try again.') });
      }, CAPTCHA_TIMEOUT_MS);
    }
  }, [clearTimer, finish, pending]);

  const onMessage = useCallback(
    (raw: string) => {
      let payload: { type?: string; token?: string; message?: string } | null = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload) return;
      if (payload.type === 'token' && payload.token) {
        finish({ token: payload.token });
        return;
      }
      if (payload.type === 'cancel') {
        finish({ error: new Error('Sign-in needs that security check. Try again.') });
        return;
      }
      if (payload.type === 'error') {
        const text = payload.message ?? '';
        setMessage(captchaFailureMessage(text));
      }
    },
    [finish],
  );

  if (!captchaEnabled() || !pending) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => finish({ error: new Error('Cancelled.') })}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.72)' }]}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Quick check</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            Confirming you’re a person. This takes a second.
          </Text>
          <View style={styles.webviewWrap}>
            <WebView
              key={attempt}
              source={{ uri: captchaPageUrl() }}
              originWhitelist={['https://*']}
              javaScriptEnabled
              domStorageEnabled
              /*
               * Turnstile runs its challenge in an iframe on
               * challenges.cloudflare.com, and that frame needs its own storage.
               * Android turns third-party cookies OFF by default, so the
               * challenge loaded and then had nowhere to keep its state: the
               * spinner turned forever and no token was ever produced. This is
               * the single most common reason a captcha "keeps loading" inside a
               * WebView, and it is invisible unless you know to look for it.
               */
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              // The widget opens no windows of its own; a popup here would be a
              // blank screen with no way back.
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically={false}
              // No cache: a stale challenge document is worse than a slow one.
              cacheEnabled={false}
              // Only the widget page and Cloudflare may be navigated to.
              onShouldStartLoadWithRequest={(req) => captchaNavigationAllowed(req.url)}
              onMessage={(event) => onMessage(event.nativeEvent.data)}
              onError={() => setMessage('The security check couldn’t load. Check your connection, then try again.')}
              onHttpError={() => setMessage('The security check couldn’t load. Check your connection, then try again.')}
              style={styles.webview}
            />
          </View>
          {message ? <Text style={[styles.error, { color: colors.danger }]}>{message}</Text> : null}
          {message ? (
            <View style={styles.actions}>
              <Pressable onPress={retry} style={styles.action}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Try again</Text>
              </Pressable>
              <Pressable onPress={() => finish({ error: new Error(message) })} style={styles.action}>
                <Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 380, borderRadius: 20, borderWidth: 1, padding: 20 },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  webviewWrap: { height: 120, marginTop: 14, borderRadius: 12, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  error: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 4 },
  action: { paddingVertical: 12, paddingHorizontal: 8 },
  actionText: { fontSize: 14, fontWeight: '700' },
  cancelText: { fontSize: 13, fontWeight: '600' },
  spinner: { marginTop: 14 },
});
