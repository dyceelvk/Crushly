import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { holupWebOpen, holupWebStatus } from '../api/service';
import {
  WEB_LIMIT_MS,
  shouldWarn,
  timeLeftLabel,
  webLimitCopy,
  webPlatform,
  webStanding,
  type WebClock,
  type WebStanding,
} from '../lib/webLimit';

/**
 * The browser's 24 hours, on screen.
 *
 * The rule is in the database and cannot be argued with from here; this is the
 * part that has to be *fair*, which means saying three things at the right
 * moments and nothing in between:
 *
 *   1. When the clock passes 18 hours, one quiet notice: you have six hours left.
 *   2. When it runs out, the standing changes — read-only on iPhone and desktop,
 *      the app wall on Android.
 *   3. Once it is read-only, every door into "write something" says so, in one
 *      sentence, and offers the way forward that actually exists.
 *
 * Deliberately absent: a countdown ticking in the corner, and a notice on every
 * screen while time remains. A clock you can always see turns the product into a
 * meter. Nothing here renders until a member is signed in on the web.
 */

function detectPlatform(): 'ios' | 'android' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const macLike = /macintosh/i.test(navigator.userAgent);
  // iPadOS 13+ calls itself a Mac. A Mac with a touch pointer is an iPad.
  if (macLike && coarse) return 'ios';
  return webPlatform(navigator.userAgent);
}

const SEEN_WARNING_KEY = 'holupp.webLimit.warned';

export function useWebLimit() {
  const { status, me } = useAuth();
  const [clock, setClock] = useState<WebClock | null>(null);
  const [standing, setStanding] = useState<WebStanding>('open');
  const platform = useRef(detectPlatform()).current;
  const recordedForMember = useRef<number | null>(null);
  const memberId = me?.id ?? null;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (status !== 'ready' || memberId == null) {
      // Do not carry one account's server verdict into another account during a
      // sign-out/sign-in transition. The next authenticated member gets a fresh
      // server result, including the unlimited entitlement when applicable.
      setClock(null);
      setStanding('open');
      recordedForMember.current = null;
      return;
    }

    let cancelled = false;
    const firstReadForMember = recordedForMember.current !== memberId;
    if (firstReadForMember) {
      // Do not let the previous account's wall flash while this account's
      // server verdict is being read.
      setClock(null);
      setStanding('open');
    }
    // Record the open once per authenticated member per app load; after that only
    // read the verdict. The server, not this ref, decides whether the member is
    // unlimited.
    const record = firstReadForMember
      ? holupWebOpen(platform)
      : holupWebStatus();
    recordedForMember.current = memberId;
    record
      .then((next) => {
        if (cancelled) return;
        setClock(next);
        setStanding(webStanding(next, platform));
      })
      .catch(() => {
        /* A clock that cannot be read must not stop anybody using the app: the
           server refuses the writes it has to refuse, and the screens stay. */
      });
    return () => {
      cancelled = true;
    };
  }, [status, memberId, platform]);

  return { clock, standing, platform, limited: standing !== 'open' };
}

type WebLimitValue = {
  clock: WebClock | null;
  standing: WebStanding;
  /** True once the browser half is over, on any platform. */
  limited: boolean;
  /** Ask the gate to say the read-only sentence *now*, because somebody just
   *  pressed something that needs writing. */
  nudge: () => void;
  nudged: boolean;
  dismiss: () => void;
};

const WebLimitContext = createContext<WebLimitValue>({
  clock: null, standing: 'open', limited: false, nudge: () => {}, nudged: false, dismiss: () => {},
});

/**
 * One clock for the whole app.
 *
 * Three places need this answer — the gate that draws the notice, the tab bar's
 * create button, and anything else that writes — and asking the database three
 * times on one page load would be three opens recorded for one visit. So the
 * clock is read once, here, and everything else reads the context.
 */
export function WebLimitProvider({ children }: { children: React.ReactNode }) {
  const state = useWebLimit();
  const [nudged, setNudged] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const value = useMemo<WebLimitValue>(() => ({
    ...state,
    nudged,
    nudge: () => { setDismissed(false); setNudged(true); },
    dismiss: () => { setDismissed(true); setNudged(false); },
  }), [state, nudged]);
  const gate = (
    <WebLimitGateView
      clock={value.clock}
      standing={value.standing}
      nudged={value.nudged}
      dismissed={dismissed}
      onDismiss={value.dismiss}
    />
  );
  return (
    <WebLimitContext.Provider value={value}>
      {children}
      {gate}
    </WebLimitContext.Provider>
  );
}

export const useWebLimitState = () => useContext(WebLimitContext);

function WebLimitGateView({ clock, standing, nudged, dismissed, onDismiss }: {
  clock: WebClock | null; standing: WebStanding; nudged: boolean; dismissed: boolean; onDismiss: () => void;
}) {
  const [warned, setWarned] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!shouldWarn(clock)) {
      setWarned(false);
      return;
    }
    try {
      if (window.sessionStorage?.getItem(SEEN_WARNING_KEY) === '1') return;
      window.sessionStorage?.setItem(SEEN_WARNING_KEY, '1');
    } catch {
      // Storage blocked: warn once per load instead of not at all.
    }
    setWarned(true);
  }, [clock]);

  if (standing === 'open' || !clock) {
    if (!warned) return null;
    return (
      <Notice
        title="Six hours of browser time left"
        body={`The browser is meant for your first day, and you have ${timeLeftLabel(clock?.remainingMs ?? 0).toLowerCase()}. After that it goes read-only: you can still read everything, but posting, Moments and clips need the app.`}
        cta="Get the app"
        onCta={() => { if (typeof window !== 'undefined') window.location.href = '/download'; }}
        onDismiss={() => setWarned(false)}
      />
    );
  }

  if (standing === 'readonly') {
    if (dismissed && !nudged) return null;
    const copy = webLimitCopy('readonly');
    return (
      <Notice
        title={copy.title}
        body={copy.body}
        cta={copy.cta}
        onCta={() => { if (typeof window !== 'undefined') window.location.href = '/download'; }}
        onDismiss={onDismiss}
      />
    );
  }

  // Android: a real wall, because there is a real download behind it. No
  // dismiss — the browser half of the product is over on this platform, and
  // pretending otherwise would be the worse experience.
  const copy = webLimitCopy('wall');
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <Pressable
            style={styles.cta}
            accessibilityRole="link"
            accessibilityLabel={copy.cta ?? 'Get the app'}
            onPress={() => { if (typeof window !== 'undefined') window.location.href = '/download'; }}
          >
            <Text style={styles.ctaText}>{copy.cta}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The one sentence a blocked browser gets at the door of a write action, from
 * the shared clock — plus `blocked` so the caller can decide what to render
 * instead of navigating somewhere the member cannot use.
 */
export function useWebLimitNotice() {
  const { limited, nudge } = useWebLimitState();
  const notice = useCallback(
    (what: string) =>
      limited
        ? `You can read ${what} in the browser, but posting needs the app. Your browser day is used up — the app is where the rest of holUpp is.`
        : null,
    [limited],
  );
  return { limited, notice, nudge };
}

function Notice({ title, body, cta, onCta, onDismiss }: { title: string; body: string; cta: string | null; onCta: () => void; onDismiss: () => void }) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <View style={styles.row}>
          <Pressable onPress={onDismiss} style={styles.ghost} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={styles.ghostText}>Not now</Text>
          </Pressable>
          {cta ? (
            <Pressable onPress={onCta} style={styles.cta} accessibilityRole="link" accessibilityLabel={cta}>
              <Text style={styles.ctaText}>{cta}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export { WEB_LIMIT_MS };

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, zIndex: 51 },
  scrim: { flex: 1, backgroundColor: 'rgba(11,7,12,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
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
  cta: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, backgroundColor: '#FF8788', alignSelf: 'flex-start', marginTop: 12 },
  ctaText: { fontSize: 14, fontWeight: '700', color: '#2A0F2B' },
});
