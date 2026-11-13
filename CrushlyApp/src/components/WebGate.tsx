import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { HolupMark } from './HolupMark';

/**
 * What a browser gets on `/`.
 *
 * holUpp is a phone product: the recording, the picker, the encoder and the
 * gallery write are all things a browser either cannot do or does badly, and a
 * half-working web copy makes the app look broken to somebody who has not
 * installed it yet. So the home page says what to do instead, and the app itself
 * stays reachable only through the routes that exist to be shared: /v/, /s/ and
 * /download.
 *
 * `typeof window` guards the export step: Expo renders this module once on the
 * server-shaped side of the web build, where `window` is undefined.
 */
export function webGateActive(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  const path = window.location?.pathname ?? '/';
  return path === '/' || path === '/index.html' || path === '';
}

export function WebGate() {
  const open = () => {
    if (typeof window !== 'undefined') window.location.href = '/download';
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <HolupMark size={92} />
        <Text style={styles.title}>holUpp lives on your phone</Text>
        <Text style={styles.body}>
          The web version isn’t open yet. Crushes, Moments, Whispers and clips all need the app —
          install it and everything is waiting for you.
        </Text>

        <Pressable onPress={open} style={styles.cta} accessibilityRole="link" accessibilityLabel="Get holUpp for Android">
          <Text style={styles.ctaText}>Get holUpp for Android</Text>
        </Pressable>

        <Text style={styles.fine}>Free · 97 MB · Android 8 and up</Text>
      </View>

      <Text style={styles.footer}>holUpp — where crushes become conversations</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: '100vh' as unknown as number,
    backgroundColor: '#0B070C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 460, alignItems: 'center' },
  title: {
    marginTop: 28,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: '#FFF8F8',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  body: {
    marginTop: 14,
    fontSize: 15,
    lineHeight: 24,
    color: '#AD8D9D',
    textAlign: 'center',
    maxWidth: 380,
  },
  cta: {
    marginTop: 28,
    paddingVertical: 16,
    paddingHorizontal: 34,
    borderRadius: 999,
    backgroundColor: '#FF8788',
  },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#2A0F2B' },
  fine: { marginTop: 14, fontSize: 12, color: '#8D7180' },
  footer: { position: 'absolute', bottom: 26, fontSize: 12, color: '#6D5563' },
});
