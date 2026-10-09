import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { useToast } from '../../components/Toast';
import { keys, useMe } from '../../api/hooks';
import { startDiditVerification, getDiditStatus, type DiditStatusResponse } from '../../api/service';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { isVerificationReturn, redirectToVerification, verificationPhase } from '../../lib/verification';
import type { ScreenProps } from '../../navigation/types';

/** What Didit checks for the member — the hosted flow runs these for us. */
const DIDIT_STEPS = [
  { icon: 'card-outline' as const, title: 'Scan your ID', body: 'Your document is checked securely by our identity partner.' },
  { icon: 'happy-outline' as const, title: 'Liveness check', body: 'Live capture only — Didit’s camera takes a fresh selfie. Photos from your gallery can’t be used.' },
  { icon: 'git-compare-outline' as const, title: 'Face match', body: 'Your selfie is matched to your document photo.' },
];

export function VerificationScreen({ navigation }: ScreenProps<'Verification'>) {
  const { data: me } = useMe();
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<DiditStatusResponse | null>(null);

  const status = result?.status ?? me?.verification.status ?? 'none';
  const verified = status === 'verified';
  const rejected = status === 'rejected';
  const hasSession = !!result?.sessionId || status === 'pending';
  const phase = verificationPhase(result?.diditStatus ?? null);
  const w = Math.min(contentWidth - gutter * 2, 340);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setResult(await getDiditStatus());
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t check the status', message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }, [qc, toast]);

  // Load the real provider state, including legacy links that were never opened.
  // A return URL is only a cue to poll — never trust its claimed result.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && isVerificationReturn(window.location.search)) {
      const params = new URLSearchParams(window.location.search);
      params.delete('didit');
      params.delete('status');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
      toast({ kind: 'info', title: 'Back from verification', message: 'Checking your result…' });
    }
    void refresh();
  }, [refresh, toast]);

  const start = async (newSession = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await startDiditVerification(newSession);
      if (Platform.OS === 'web') redirectToVerification(url, window.location);
      else await Linking.openURL(url);
      void qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t start verification', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        verified ? undefined : (
          <View style={{ gap: space.xs }}>
            <Button
              title={rejected ? 'Try verification again' : hasSession ? 'Continue verification' : 'Start verification'}
              icon="shield-checkmark-outline"
              onPress={() => void start(rejected)}
              loading={busy}
              disabled={checking}
            />
            {hasSession ? (
              <>
                <Button title="Check status" variant="secondary" icon="refresh" onPress={refresh} loading={checking} disabled={busy} />
                <Button title="Start a new session" variant="ghost" onPress={() => void start(true)} disabled={busy || checking} />
              </>
            ) : null}
          </View>
        )
      }
    >
      <Header title="Get verified" back onBack={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Profile' })} />

      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <View>
          <Avatar uri={me?.profile.photos[0]?.url} name={me?.profile.name} size={104} ring={verified ? 'gold' : undefined} />
          {verified ? (
            <View style={{ position: 'absolute', right: 0, bottom: 4 }}>
              <VerifiedBadge size={30} />
            </View>
          ) : null}
        </View>
      </View>

      {verified ? (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
          <Txt variant="heading" align="center">
            You’re verified
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: w }}>
            Your badge shows on your profile. Thanks for keeping Crushly real.
          </Txt>
        </View>
      ) : rejected ? (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
          <Txt variant="heading" align="center">
            Verification didn’t pass
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: w }}>
            That happens — a blurry document or a bad angle is usually all it is. You can try again with a fresh session.
          </Txt>
        </View>
      ) : hasSession ? (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
          <Txt variant="heading" align="center">
            {phase === 'review' ? 'Verification under review' : phase === 'progress' ? 'Finish your verification' : 'Ready to verify'}
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: w }}>
            {phase === 'review'
              ? 'Your submitted checks are being reviewed. Tap “Check status” for the latest result.'
              : 'Tap “Continue verification” to open the checks. Creating a session does not submit your verification or put it under review. Crushly will redirect you to Didit, then back here when you finish.'}
          </Txt>
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.md }}>
          <Txt variant="heading" align="center">
            Prove it’s really you
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: w }}>
            Verification runs through our certified identity partner. Crushly will redirect you to Didit, then bring you back here when you finish. Tapping the button only opens those checks — it doesn’t submit anything or put you in review; the result arrives when you complete them with Didit.
          </Txt>
          <View style={{ width: w, gap: space.sm, marginTop: space.xs }}>
            {DIDIT_STEPS.map((s) => (
              <View key={s.title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.goldSoft,
                    borderWidth: 1,
                    borderColor: colors.goldLine,
                  }}
                >
                  <Ionicons name={s.icon} size={18} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{s.title}</Txt>
                  <Txt variant="small" color="textMuted">
                    {s.body}
                  </Txt>
                </View>
              </View>
            ))}
          </View>
          <View style={{ width: w, padding: space.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Txt variant="small" color="textSecondary">
              Your ID is checked securely by our identity partner and is never shown to other members. Your verification result controls the badge on your profile.
            </Txt>
          </View>
        </View>
      )}
    </Screen>
  );
}
