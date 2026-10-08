import React, { useEffect, useState } from 'react';
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
import { startDiditVerification, getDiditStatus } from '../../api/service';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

/** What Didit checks for the member — the hosted flow runs these for us. */
const DIDIT_STEPS = [
  { icon: 'card-outline' as const, title: 'Scan your ID', body: 'Didit reads your document — Crushly never sees it.' },
  { icon: 'happy-outline' as const, title: 'Liveness check', body: 'A quick face scan proves you’re really there.' },
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

  const status = me?.verification.status ?? 'none';
  const verified = status === 'verified';
  const rejected = status === 'rejected';
  const pending = status === 'pending';
  const w = Math.min(contentWidth - gutter * 2, 340);

  const refresh = async () => {
    setChecking(true);
    try {
      await getDiditStatus();
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t check the status', message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  // Didit sends the member back to /?didit=done&status=… — pick that up here.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('didit') === 'done') {
      window.history.replaceState({}, '', window.location.pathname);
      toast({ kind: 'info', title: 'Back from Didit', message: 'Checking your result…' });
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const { url } = await startDiditVerification();
      await qc.invalidateQueries({ queryKey: keys.me });
      if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
      else await Linking.openURL(url);
      toast({
        kind: 'success',
        title: 'Didit is open',
        message: 'Finish the steps there, then come back and tap “Check status”.',
      });
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
            {!pending ? (
              <Button
                title={rejected ? 'Try verification again' : 'Verify with Didit'}
                icon="shield-checkmark-outline"
                onPress={start}
                loading={busy}
              />
            ) : null}
            {pending ? (
              <>
                <Button title="Check status" variant="secondary" icon="refresh" onPress={refresh} loading={checking} />
                <Button title="Start a new session" variant="ghost" onPress={start} loading={busy} />
              </>
            ) : null}
          </View>
        )
      }
    >
      <Header title="Get verified" back onBack={() => navigation.goBack()} />

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
      ) : pending ? (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
          <Txt variant="heading" align="center">
            Verification in progress
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: w }}>
            Finish the steps in the Didit window, then come back here. Results usually land within a minute — the webhook settles it automatically.
          </Txt>
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.md }}>
          <Txt variant="heading" align="center">
            Prove it’s really you
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: w }}>
            Verification runs through Didit — a certified identity check. It takes about two minutes.
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
              Your ID document is checked by Didit and never shown to Crushly or other members. Only the pass/fail result reaches your profile.
            </Txt>
          </View>
        </View>
      )}
    </Screen>
  );
}
