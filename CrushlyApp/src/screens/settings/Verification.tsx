import React, { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Photo, Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { useToast } from '../../components/Toast';
import { keys, useMe } from '../../api/hooks';
import { submitVerification, type AiVerificationResult } from '../../api/service';
import { pickImage, type PickedImage } from '../../lib/media';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

/** The illustrated pose library — the app and the AI both know exactly what to expect.
 *  Each verification attempt draws two random poses so no two check-ins look alike. */
type PoseDef = { pose: string; title: string; body: string; image: number };

const POSE_LIBRARY: PoseDef[] = [
  {
    pose: 'Peace sign & smile',
    title: 'Peace sign & smile',
    body: 'Smile big and hold up a peace sign beside your face.',
    image: require('../../../assets/poses/pose-1.png'),
  },
  {
    pose: 'Hand on cheek, tilt',
    title: 'Hand on cheek',
    body: 'Rest one hand softly on your cheek and tilt your head a little.',
    image: require('../../../assets/poses/pose-2.png'),
  },
  {
    pose: 'Wink & wave',
    title: 'Wink & wave',
    body: 'Wink one eye and give a little wave beside your face.',
    image: require('../../../assets/poses/pose-3.png'),
  },
  {
    pose: 'Thumbs up',
    title: 'Thumbs up',
    body: 'Give a cheerful thumbs up with one hand near your chest.',
    image: require('../../../assets/poses/pose-4.png'),
  },
  {
    pose: 'Heart fingers',
    title: 'Heart fingers',
    body: 'Make a small heart shape with one hand beside your face.',
    image: require('../../../assets/poses/pose-5.png'),
  },
  {
    pose: 'Finger heart',
    title: 'Finger heart',
    body: 'Cross your thumb and index finger for a tiny finger heart near your cheek.',
    image: require('../../../assets/poses/pose-6.png'),
  },
  {
    pose: 'Flower hand',
    title: 'Flower hand',
    body: 'Curve one hand beside your face like a flower petal.',
    image: require('../../../assets/poses/pose-7.png'),
  },
  {
    pose: 'Hand on hip',
    title: 'Hand on hip',
    body: 'Rest one hand on your hip and give a confident smile.',
    image: require('../../../assets/poses/pose-8.png'),
  },
  {
    pose: 'Blowing a kiss',
    title: 'Blowing a kiss',
    body: 'Blow a kiss with one hand near your lips.',
    image: require('../../../assets/poses/pose-9.png'),
  },
  {
    pose: 'Celebration arm',
    title: 'Celebration arm',
    body: 'Raise one arm up in celebration.',
    image: require('../../../assets/poses/pose-10.png'),
  },
  {
    pose: 'Hand behind head',
    title: 'Hand behind head',
    body: 'Rest one hand behind your head with a playful look.',
    image: require('../../../assets/poses/pose-11.png'),
  },
  {
    pose: 'Salute & wink',
    title: 'Salute & wink',
    body: 'Give a playful salute with one hand and wink.',
    image: require('../../../assets/poses/pose-12.png'),
  },
];

function drawSteps(): PoseDef[] {
  const a = Math.floor(Math.random() * POSE_LIBRARY.length);
  let b = Math.floor(Math.random() * POSE_LIBRARY.length);
  while (b === a) b = Math.floor(Math.random() * POSE_LIBRARY.length);
  return [POSE_LIBRARY[a], POSE_LIBRARY[b]];
}

type Phase = 'intro' | 'capture' | 'review' | 'result';

export function VerificationScreen({ navigation }: ScreenProps<'Verification'>) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<PoseDef[]>(() => drawSteps());
  const [captures, setCaptures] = useState<(PickedImage | null)[]>([null, null]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiVerificationResult | null>(null);
  const status = me?.verification.status ?? 'none';

  const w = Math.min(contentWidth - gutter * 2, 320);
  const step = steps[index];

  const capture = async () => {
    const img = await pickImage({ camera: true, square: true });
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Camera unavailable', message: img.error });
    // Stay on this step so the member sees the captured state and chooses
    // Next pose / Retake from the footer instead of being jumped forward.
    setCaptures((prev) => prev.map((c, i) => (i === index ? img : c)));
  };

  const submit = async () => {
    if (captures.some((c) => !c)) return;
    setBusy(true);
    try {
      const items = captures.map((c, i) => ({
        uri: c!.uri,
        mimeType: c!.mimeType,
        pose: steps[i].pose,
      }));
      const { me: next, result: verdict } = await submitVerification(items);
      qc.setQueryData(keys.me, next);
      setResult(verdict);
      setPhase('result');
    } catch (e) {
      toast({ kind: 'error', title: 'Not submitted', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSteps(drawSteps());
    setCaptures([null, null]);
    setIndex(0);
    setResult(null);
    setPhase('capture');
  };

  if (status === 'verified' && phase !== 'result') {
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

  if (status === 'pending' && phase === 'intro') {
    return (
      <Screen footer={<Button title="Submit a new selfie" variant="outline" onPress={reset} />}>
        <Header title="Verification" back />
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="hourglass-outline" size={36} color={colors.gold} />
          </View>
          <Txt variant="heading" align="center" style={{ marginTop: space.lg }}>
            Review in progress
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: 6, maxWidth: 340 }}>
            Most checks finish in seconds. If our team needs a closer look, you’ll get a notification as soon as it’s done.
          </Txt>
        </View>
      </Screen>
    );
  }

  if (phase === 'result' && result) {
    const ok = result.status === 'verified';
    const pending = result.status === 'pending';
    return (
      <Screen footer={<Button title={ok ? 'Done' : pending ? 'Back' : 'Try again'} onPress={() => (ok || pending ? navigation.goBack() : reset())} />}>
        <Header title="Get verified" back onBack={() => navigation.goBack()} />
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: ok ? colors.goldSoft : pending ? colors.goldSoft : colors.dangerSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {ok ? <VerifiedBadge size={56} /> : <Ionicons name={pending ? 'hourglass-outline' : 'alert-circle-outline'} size={44} color={pending ? colors.gold : colors.danger} />}
          </View>
          <Txt variant="heading" align="center" style={{ marginTop: space.lg }}>
            {ok ? 'You’re verified!' : pending ? 'Almost there' : 'Not quite this time'}
          </Txt>
          <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: 8, maxWidth: 330 }}>
            {result.reason ||
              (ok
                ? 'The blue check is yours.'
                : pending
                  ? 'Our team will finish the review shortly.'
                  : 'The selfie didn’t match your profile photos clearly enough.')}
          </Txt>
          {ok ? (
            <View style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <VerifiedBadge size={18} />
              <Txt variant="small" color="textMuted" style={{ flex: 1, maxWidth: 280 }}>
                Verified members get this small check next to their name. Free, always.
              </Txt>
            </View>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        phase === 'intro' ? (
          <Button title="Start verification" onPress={() => setPhase('capture')} />
        ) : phase === 'capture' ? (
          captures[index] ? (
            <View style={{ gap: space.xs }}>
              {index < steps.length - 1 ? (
                <Button title="Next pose" icon="arrow-forward" onPress={() => setIndex(index + 1)} />
              ) : (
                <Button title="Review my selfies" icon="checkmark" onPress={() => setPhase('review')} />
              )}
              <Button title="Retake this one" variant="ghost" onPress={capture} />
            </View>
          ) : (
            <Button
              title={Platform.OS === 'web' ? 'Choose your selfie' : 'Take my selfie'}
              icon="camera-outline"
              onPress={capture}
            />
          )
        ) : (
          <View style={{ gap: space.xs }}>
            <Button title="Check my selfies" icon="sparkles-outline" onPress={submit} loading={busy} />
            <Button title="Retake photos" variant="ghost" onPress={reset} />
          </View>
        )
      }
    >
      <Header
        title="Get verified"
        back
        onBack={
          phase === 'intro'
            ? undefined
            : () => (phase === 'capture' && index > 0 ? setIndex(index - 1) : setPhase(phase === 'review' ? 'capture' : 'intro'))
        }
      />

      {phase === 'intro' ? (
        <>
          <Txt variant="accent" color="textSecondary">
            Make your profile more trustworthy.
          </Txt>
          {status === 'rejected' ? (
            <View style={{ marginTop: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, flexDirection: 'row', gap: 10 }}>
              <Ionicons name="information-circle-outline" size={20} color={colors.danger} />
              <Txt variant="small" style={{ flex: 1 }}>
                Your last selfie couldn’t be matched. Make sure your face is clearly lit and copy the poses exactly.
              </Txt>
            </View>
          ) : null}
          <View style={{ marginTop: space.xl, gap: space.lg }}>
            {[
              { icon: 'images-outline' as const, title: 'Follow the poses', body: 'Two simple illustrated poses — we’ll show you exactly how.' },
              { icon: 'camera-outline' as const, title: 'Take two selfies', body: 'Good light, face the camera, no sunglasses.' },
              { icon: 'sparkles-outline' as const, title: 'AI checks it in seconds', body: 'Our AI compares your selfies with your profile photos to make sure it’s really you.' },
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
              Verified members get this small check next to their name. Your selfies stay private and are never shown to other members.
            </Txt>
          </View>
        </>
      ) : phase === 'capture' ? (
        <View style={{ alignItems: 'center', marginTop: space.lg }}>
          <Txt variant="label" color="textMuted">
            Pose {index + 1} — {step.title}
          </Txt>
          <View style={{ width: w, height: w, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldLine, marginTop: space.sm }}>
            <Image source={step.image} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel={`Illustration: ${step.title}`} />
          </View>
          <Txt variant="body" align="center" color="textSecondary" style={{ marginTop: space.md, maxWidth: 320 }}>
            {step.body}
          </Txt>
          {captures[index] ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md }}>
              <Ionicons name="checkmark-circle" size={18} color={colors.gold} />
              <Txt variant="smallStrong">Captured — nice one!</Txt>
            </View>
          ) : (
            <Txt variant="small" color="textMuted" align="center" style={{ marginTop: space.md, maxWidth: 320 }}>
              Copy the illustration as closely as you can. Only the verification system sees these photos.
            </Txt>
          )}
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.md }}>
          <Txt variant="heading" align="center">
            Looking good
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {captures.map((c, i) => (
              <View key={i} style={{ alignItems: 'center' }}>
                <Photo uri={c?.uri} style={{ width: w / 2 - space.md, height: w / 2 - space.md, borderRadius: radius.lg }} contentPosition="center" alt={`Selfie ${i + 1}`} />
                <Txt variant="small" color="textMuted" style={{ marginTop: 6 }}>
                  {steps[i].pose}
                </Txt>
              </View>
            ))}
          </View>
          <Txt variant="small" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
            Our AI will compare these with your profile photos. It usually takes just a few seconds.
          </Txt>
        </View>
      )}
    </Screen>
  );
}
