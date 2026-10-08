import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Photo, Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { useToast } from '../../components/Toast';
import { keys, useMe } from '../../api/hooks';
import { api, appendFile } from '../../api/client';
import type { Me } from '../../api/types';
import { pickImage, type PickedImage } from '../../lib/media';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

export function VerificationScreen({ navigation }: ScreenProps<'Verification'>) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [step, setStep] = useState<'intro' | 'pose' | 'review'>('intro');
  const [pose, setPose] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const status = me?.verification.status ?? 'none';

  useEffect(() => {
    if (step === 'pose' && !pose) {
      api.get<{ pose: string }>('/me/verification/pose').then((r) => setPose(r.pose)).catch((e) => toast({ kind: 'error', title: 'Couldn’t start', message: (e as Error).message }));
    }
  }, [step, pose, toast]);

  const capture = async () => {
    const img = await pickImage({ camera: true, square: true });
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Camera unavailable', message: img.error });
    setSelfie(img);
    setStep('review');
  };

  const submit = async () => {
    if (!selfie || !pose) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('pose', pose);
      await appendFile(form, 'selfie', selfie.uri, 'selfie.jpg', selfie.mimeType);
      const next = await api.upload<Me>('/me/verification', form);
      qc.setQueryData(keys.me, next);
      toast({ kind: 'success', title: 'Selfie submitted', message: 'We’ll review it shortly and let you know.' });
      setStep('intro');
      setSelfie(null);
      setPose(null);
    } catch (e) {
      toast({ kind: 'error', title: 'Not submitted', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const w = Math.min(contentWidth - gutter * 2, 320);

  if (status === 'verified') {
    return (
      <Screen>
        <Header title="Verification" back />
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <View>
            <Avatar uri={me?.profile.photos[0]?.url} name={me?.profile.name} size={120} ring="gold" />
            <View style={{ position: 'absolute', right: 0, bottom: 4 }}>
              <VerifiedBadge size={34} />
            </View>
          </View>
          <Txt variant="heading" align="center" style={{ marginTop: space.lg }}>
            You’re verified
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: 6, maxWidth: 320 }}>
            The small check next to your name tells people your photos are really you. It can’t be bought — only earned.
          </Txt>
        </View>
      </Screen>
    );
  }

  if (status === 'pending' && step === 'intro') {
    return (
      <Screen>
        <Header title="Verification" back />
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="hourglass-outline" size={36} color={colors.gold} />
          </View>
          <Txt variant="heading" align="center" style={{ marginTop: space.lg }}>
            We’re reviewing your selfie
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: 6, maxWidth: 340 }}>
            A real person on our team compares it with your photos. You’ll get a notification as soon as it’s done.
          </Txt>
          <Button title="Submit a new selfie" variant="ghost" onPress={() => setStep('pose')} style={{ marginTop: space.lg }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={
      step === 'intro' ? <Button title="Start verification" onPress={() => setStep('pose')} /> :
      step === 'pose' ? <Button title={Platform.OS === 'web' ? 'Choose your selfie' : 'Take my selfie'} icon="camera-outline" onPress={capture} disabled={!pose} /> :
      <View style={{ gap: space.xs }}>
        <Button title="Submit for review" onPress={submit} loading={busy} />
        <Button title="Retake" variant="ghost" onPress={capture} />
      </View>
    }>
      <Header title="Get verified" back onBack={step === 'intro' ? undefined : () => setStep(step === 'review' ? 'pose' : 'intro')} />

      {step === 'intro' ? (
        <>
          <Txt variant="accent" color="textSecondary">
            Make your profile more trustworthy.
          </Txt>
          {status === 'rejected' ? (
            <View style={{ marginTop: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, flexDirection: 'row', gap: 10 }}>
              <Ionicons name="information-circle-outline" size={20} color={colors.danger} />
              <Txt variant="small" style={{ flex: 1 }}>
                Your last selfie couldn’t be matched. Make sure your face is clearly lit and you copy the pose exactly.
              </Txt>
            </View>
          ) : null}
          <View style={{ marginTop: space.xl, gap: space.lg }}>
            {[
              { icon: 'hand-left-outline' as const, title: 'Copy a pose', body: 'We’ll show you a simple pose so we know it’s a live photo.' },
              { icon: 'camera-outline' as const, title: 'Take a selfie', body: 'Good light, face the camera, no sunglasses.' },
              { icon: 'person-outline' as const, title: 'A real person reviews it', body: 'We compare it with your profile photos. Your selfie is never shown to anyone.' },
            ].map((s, i) => (
              <View key={s.title} style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldLine, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={s.icon} size={20} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">
                    {i + 1}. {s.title}
                  </Txt>
                  <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
                    {s.body}
                  </Txt>
                </View>
              </View>
            ))}
          </View>
          <View style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <VerifiedBadge size={18} />
            <Txt variant="small" color="textMuted" style={{ flex: 1 }}>
              Verified members get this small check next to their name. Free, always.
            </Txt>
          </View>
        </>
      ) : step === 'pose' ? (
        <View style={{ alignItems: 'center', marginTop: space.lg }}>
          <View style={{ width: w, height: w, borderRadius: radius.xl, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldLine, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
            <Ionicons name="hand-left-outline" size={56} color={colors.gold} />
            <Txt variant="label" color="textMuted" style={{ marginTop: space.lg }}>
              Your pose
            </Txt>
            <Txt variant="heading" align="center" style={{ marginTop: 6 }} accessibilityLiveRegion="polite">
              {pose ?? '…'}
            </Txt>
          </View>
          <Txt variant="small" color="textSecondary" align="center" style={{ marginTop: space.lg, maxWidth: 320 }}>
            Hold the pose and take a clear selfie. Only our review team sees it, and it’s deleted after review.
          </Txt>
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginTop: space.lg }}>
          <Photo uri={selfie?.uri} style={{ width: w, height: w, borderRadius: radius.xl }} contentPosition="center" alt="Your selfie" />
          <Txt variant="small" color="textSecondary" align="center" style={{ marginTop: space.md }}>
            Pose: {pose}
          </Txt>
        </View>
      )}
    </Screen>
  );
}
