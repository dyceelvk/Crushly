import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * What a browser is told when it opens the app.
 *
 * 1.0.106 replaced `/` in the browser with a wall that said holUpp lives on
 * your phone. That wall was right about clips — a browser cannot record one the
 * way the app does — but it was the whole home page, which made the website
 * unable to say anything at all, and it made the "Continue on Web" button on
 * holupp.net point at a door that does not open.
 *
 * So: the app opens in the browser, and this notice sits over it once, saying
 * the one true thing — clips and Moments are phone work — and offering the
 * download. Dismissing it is remembered for the session, so somebody who chose
 * the browser is not asked again on every screen.
 */

const DISMISS_KEY = 'holupp.webNotice.dismissed';

function isSharedRoute(path: string): boolean {
  // A shared post or Space link is opened by people who were sent it, not by
  // people browsing. Do not interrupt them with a download pitch.
  return path.startsWith('/v/') || path.startsWith('/s/') || path === '/download' || path.startsWith('/download/');
}

/**
 * The notice is gone.
 *
 * It was a card over the home page telling a visitor they were on the web and
 * offering the app before they had seen a single post. That is an interstitial,
 * and an interstitial on a site whose whole argument is "look at the room" argues
 * against itself. The web now opens on the room (`WatchScreen`) with the app
 * download in the footer and on `/download`, where a person who has decided they
 * want it will look.
 *
 * Kept as a function, returning false, because `WebNotice` is mounted in the app
 * shell and every caller already asks this question. Deleting the call sites would
 * be a bigger diff for the same result, and this comment is the answer to the next
 * person who wonders why the notice is never visible.
 */
export function webGateActive(): boolean {
  return false;
}

export function WebNotice() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  const dismiss = () => {
    setOpen(false);
    try {
      window.sessionStorage?.setItem(DISMISS_KEY, '1');
    } catch {
      // Nothing to remember with; the notice simply returns next load.
    }
  };

  const download = () => {
    if (typeof window !== 'undefined') window.location.href = '/download';
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.title}>You’re on the web version</Text>
        <Text style={styles.body}>
          Everything is here except clips and recording Moments — those need the phone app.
        </Text>
        <View style={styles.row}>
          <Pressable onPress={dismiss} style={styles.ghost} accessibilityRole="button" accessibilityLabel="Keep browsing holUpp in this browser">
            <Text style={styles.ghostText}>Keep browsing</Text>
          </Pressable>
          <Pressable onPress={download} style={styles.cta} accessibilityRole="link" accessibilityLabel="Get holUpp for Android">
            <Text style={styles.ctaText}>Get the app</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    zIndex: 50,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: '#231024',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#4A2346',
  },
  title: { fontSize: 15, fontWeight: '700', color: '#FFF8F8' },
  body: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#AD8D9D' },
  row: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  ghost: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 },
  ghostText: { fontSize: 14, fontWeight: '600', color: '#AD8D9D' },
  cta: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, backgroundColor: '#FF8788' },
  ctaText: { fontSize: 14, fontWeight: '700', color: '#2A0F2B' },
});
