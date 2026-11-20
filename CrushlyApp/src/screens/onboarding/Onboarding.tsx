import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Glow } from '../../components/Ambient';
import { Logo } from '../../components/Logo';
import { Screen, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { UsernameField } from '../../components/UsernameField';
import { useSetUsername, useMe, useUpdateProfile } from '../../api/hooks';
import { Avatar } from '../../components/Photo';
import { PhotoGrid } from '../../components/PhotoGrid';
import { useToast } from '../../components/Toast';
import { completeOnboarding } from '../../api/service';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { haptic } from '../../lib/haptics';
import { HIT, alpha, radius, rhythm, space, stroke } from '../../theme/tokens';
import { EXPRESSION_STYLES, ONBOARDING_INTERESTS } from '../../lib/catalog';
import type { ExpressionStyle } from '../../api/types';
import type { ScreenProps } from '../../navigation/types';

const TOTAL = 6;

/** The six stops are part of the story: meet the network before its features. */
function StepSegments({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: step }}
      style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: i < step ? colors.primary : colors.elevated,
            opacity: i < step ? 1 : alpha.solid,
          }}
        />
      ))}
    </View>
  );
}

/**
 * One frame for the whole welcome journey.
 *
 * The footer owns the forward action, so every step has one obvious way through.
 * The content is allowed to scroll independently, which matters for the profile
 * step on a small phone and for the interest grid with a large text setting.
 */
function Shell({
  step, title, subtitle, children, onNext, nextLabel = 'Continue', nextDisabled, loading, onBack,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  onBack?: () => void;
}) {
  const { colors, reduceMotion } = useTheme();
  const { signOut } = useAuth();
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    Animated.timing(entrance, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [entrance, reduceMotion]);

  return (
    <Screen
      keyboard
      scrollProps={{ showsVerticalScrollIndicator: true }}
      footer={(
        <View>
          <View style={{ height: stroke.hairline, backgroundColor: colors.border, marginBottom: space.md }} />
          <Button title={nextLabel} onPress={onNext} disabled={nextDisabled} loading={loading} />
        </View>
      )}
    >
      <Glow size={520} color={colors.primary} opacity={0.22} style={{ position: 'absolute', top: -180, right: -220 }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm, minHeight: HIT }}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            style={({ pressed }) => ({
              width: HIT,
              height: HIT,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: colors.elevated,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>
        ) : (
          <View style={{ width: HIT, height: HIT }} />
        )}
        <Txt variant="label" color="textMuted">
          Step {step} of {TOTAL}
        </Txt>
        {step === 1 ? (
          <Pressable
            onPress={signOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={12}
            style={({ pressed }) => ({ minHeight: HIT, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Txt variant="small" color="textMuted">Sign out</Txt>
          </Pressable>
        ) : (
          <View style={{ width: HIT, height: HIT }} />
        )}
      </View>

      <View style={{ marginTop: space.sm }}>
        <StepSegments step={step} total={TOTAL} />
      </View>

      <Animated.View
        style={{
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        }}
      >
        <View style={{ marginTop: rhythm.section }}>
          <Txt variant="title" accessibilityRole="header">
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="body" color="textSecondary" style={{ marginTop: space.xs, maxWidth: 380 }}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <View style={{ marginTop: rhythm.section }}>{children}</View>
      </Animated.View>
    </Screen>
  );
}

function useSaver() {
  const toast = useToast();
  const update = useUpdateProfile();
  const save = async (patch: Record<string, unknown>) => {
    try {
      await update.mutateAsync(patch);
      return true;
    } catch (e) {
      toast({ kind: 'error', title: 'Not saved yet', message: (e as Error).message });
      return false;
    }
  };
  return { save, saving: update.isPending };
}

function Section({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: rhythm.section }}>
      <Txt variant="label" color="textSecondary" style={{ marginBottom: rhythm.tight }}>
        {label}
      </Txt>
      {children}
      {error || hint ? (
        <Txt variant="small" color={error ? 'danger' : 'textMuted'} style={{ marginTop: rhythm.tight }}>
          {error || hint}
        </Txt>
      ) : null}
    </View>
  );
}

function SelectableCard({
  selected, onPress, icon, title, description, accessibilityLabel,
}: {
  selected: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel || title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.sm,
        minHeight: 74,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySoft : colors.card,
        opacity: pressed ? 0.84 : 1,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.primary : colors.elevated }}>
        <Ionicons name={icon} size={20} color={selected ? colors.onPrimary : colors.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyStrong">{title}</Txt>
        <Txt variant="small" color="textSecondary" style={{ marginTop: 1 }}>{description}</Txt>
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: selected ? colors.primary : colors.borderStrong, backgroundColor: selected ? colors.primary : 'transparent' }}>
        {selected ? <Ionicons name="checkmark" size={13} color={colors.onPrimary} /> : null}
      </View>
    </Pressable>
  );
}

/** 1 — the product promise, before asking for personal information. */
export function OnboardingWelcomeScreen({ navigation }: ScreenProps<'OnboardingWelcome'>) {
  const { colors } = useTheme();
  return (
    <Shell step={1} title="Welcome to HolUpp" subtitle="Your world. Your people. Your expression." onNext={() => navigation.navigate('OnboardingBasics')} nextLabel="Build your space">
      <View style={{ alignItems: 'center', paddingTop: space.xs }}>
        <View style={{ width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryLine }}>
          <Logo size={52} />
        </View>
        <Txt variant="heading" align="center" style={{ marginTop: space.lg, maxWidth: 310 }}>
          A social network for what matters to you.
        </Txt>
        <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: space.xs, maxWidth: 340 }}>
          Share your perspective, discover new people and make a Space that feels like yours.
        </Txt>
      </View>

      <View style={{ marginTop: rhythm.section, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
          <Ionicons name="sparkles-outline" size={20} color={colors.primary} style={{ marginTop: 1 }} />
          <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
            Crushes, romantic connections and personal relationships are part of HolUpp — but they are things you discover naturally inside the network, not the reason it exists.
          </Txt>
        </View>
      </View>
    </Shell>
  );
}

/** 2 — identity, profile picture and the first words people meet. */
export function OnboardingBasicsScreen({ navigation }: ScreenProps<'OnboardingBasics'>) {
  const { data: me } = useMe();
  const toast = useToast();
  const p = me?.profile;
  const { contentWidth, gutter } = useLayout();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setHandle = useSetUsername();
  const { save, saving } = useSaver();
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const photos = me?.profile.photos || [];

  useEffect(() => {
    if (!p) return;
    setName((current) => current || p.name || '');
    setUsername((current) => current || p.username || '');
    setBio((current) => current || p.bio || '');
    if (p.birthdate) {
      const [storedYear, storedMonth, storedDay] = p.birthdate.split('-');
      setYear((current) => current || storedYear || '');
      setMonth((current) => current || storedMonth || '');
      setDay((current) => current || storedDay || '');
    }
  }, [p]);

  const next = async () => {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'What should we call you?';
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    if (!d || !m || !y || year.length !== 4 || d < 1 || d > 31 || m < 1 || m > 12) nextErrors.birthday = 'Enter your full birthday.';
    const handle = username.trim().toLowerCase();
    if (!handle) nextErrors.username = 'Pick a username — it is how people find you.';
    else if (!/^[a-z0-9_]{3,20}$/.test(handle)) nextErrors.username = 'Usernames are 3–20 characters: letters, numbers and underscores.';
    else if (!/[a-z]/.test(handle)) nextErrors.username = 'Use at least one letter.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !photos.length) return;

    const saved = await save({
      name: name.trim(),
      birthdate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      bio: bio.trim(),
    });
    if (!saved) return;

    if (handle !== (p?.username || '')) {
      try {
        await setHandle.mutateAsync(handle);
      } catch (err) {
        toast({ kind: 'error', title: 'Username not saved', message: (err as Error).message });
        return;
      }
    }
    navigation.navigate('OnboardingInterests');
  };

  return (
    <Shell
      step={2}
      title="Tell us about yourself"
      subtitle="Start with the basics. You can shape the rest of your Space anytime."
      onBack={() => navigation.goBack()}
      onNext={next}
      loading={saving || setHandle.isPending}
      nextDisabled={!photos.length}
      nextLabel={photos.length ? 'Continue' : 'Add a profile picture to continue'}
    >
      <View style={{ gap: rhythm.group }}>
        <Input label="Name" value={name} onChangeText={setName} placeholder="Your name" autoComplete="given-name" textContentType="givenName" maxLength={30} error={errors.name} />
        <UsernameField value={username} onChange={setUsername} error={errors.username} hint="This is how people find you on HolUpp." />

        <Section label="Birthday" error={errors.birthday} hint="Your birthday stays private. We only use it to show your age and keep HolUpp safe.">
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Input containerStyle={{ flex: 1 }} value={day} onChangeText={(value) => { const clean = value.replace(/\D/g, '').slice(0, 2); setDay(clean); if (clean.length === 2) monthRef.current?.focus(); }} placeholder="DD" keyboardType="number-pad" maxLength={2} accessibilityLabel="Birth day" style={{ textAlign: 'center' }} />
            <Input ref={monthRef} containerStyle={{ flex: 1 }} value={month} onChangeText={(value) => { const clean = value.replace(/\D/g, '').slice(0, 2); setMonth(clean); if (clean.length === 2) yearRef.current?.focus(); }} placeholder="MM" keyboardType="number-pad" maxLength={2} accessibilityLabel="Birth month" style={{ textAlign: 'center' }} />
            <Input ref={yearRef} containerStyle={{ flex: 1.5 }} value={year} onChangeText={(value) => setYear(value.replace(/\D/g, '').slice(0, 4))} placeholder="YYYY" keyboardType="number-pad" maxLength={4} accessibilityLabel="Birth year" style={{ textAlign: 'center' }} />
          </View>
        </Section>

        <Section label="Profile picture" hint="Add one photo to start. You can add more to your Space later.">
          <PhotoGrid photos={photos} width={contentWidth - gutter * 2} />
        </Section>

        <Section label="Short bio" hint="A sentence or two is enough. Let people know what you are about.">
          <Input value={bio} onChangeText={setBio} multiline maxLength={500} showCount placeholder="What are you into? What should people know?" accessibilityLabel="Short bio" />
        </Section>
      </View>
    </Shell>
  );
}

/** 3 — interests are the first discovery signal, not relationship intent. */
export function OnboardingInterestsScreen({ navigation }: ScreenProps<'OnboardingInterests'>) {
  const { data: me } = useMe();
  const [selected, setSelected] = useState<string[]>([]);
  const { save, saving } = useSaver();
  const profileInterests = me?.profile.interests;

  useEffect(() => {
    if (profileInterests?.length && !selected.length) setSelected(profileInterests);
  }, [profileInterests, selected.length]);

  const toggle = (value: string) => {
    setSelected((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : current.length >= 10 ? current : [...current, value]);
  };

  return (
    <Shell
      step={3}
      title="What interests you?"
      subtitle="Choose the topics, scenes and ideas you want your HolUpp world to open up around."
      onBack={() => navigation.goBack()}
      onNext={async () => (await save({ interests: selected })) && navigation.navigate('OnboardingExpression')}
      loading={saving}
      nextDisabled={!selected.length}
      nextLabel={selected.length ? 'Continue' : 'Choose an interest to continue'}
    >
      <Txt variant="small" color="textMuted" style={{ marginBottom: space.sm }}>
        {selected.length}/10 selected · You can change these anytime.
      </Txt>
      <View style={{ gap: space.xs }}>
        {ONBOARDING_INTERESTS.map((interest) => (
          <SelectableCard
            key={interest.label}
            selected={selected.includes(interest.label)}
            onPress={() => toggle(interest.label)}
            icon={interest.icon}
            title={interest.label}
            description={interest.description}
          />
        ))}
      </View>
    </Shell>
  );
}

/** 4 — expression makes the network about creation, not only consumption. */
export function OnboardingExpressionScreen({ navigation }: ScreenProps<'OnboardingExpression'>) {
  const { data: me } = useMe();
  const p = me?.profile;
  const [selected, setSelected] = useState<ExpressionStyle | ''>('');
  const { save, saving } = useSaver();

  useEffect(() => {
    const value = p?.lifestyle?.expressionStyle;
    if (value && !selected) setSelected(value as ExpressionStyle);
  }, [p, selected]);

  return (
    <Shell
      step={4}
      title="How do you like expressing yourself?"
      subtitle="There is no right way to show up. Pick the one that feels most like you right now."
      onBack={() => navigation.goBack()}
      onNext={async () => {
        if (!selected) return;
        const ok = await save({ lifestyle: { ...p?.lifestyle, expressionStyle: selected } });
        if (ok) navigation.navigate('OnboardingFeatures');
      }}
      loading={saving}
      nextDisabled={!selected}
      nextLabel={selected ? 'Continue' : 'Choose what feels like you'}
    >
      <View style={{ gap: space.sm }}>
        {EXPRESSION_STYLES.map((option) => (
          <SelectableCard
            key={option.value}
            selected={selected === option.value}
            onPress={() => setSelected(option.value)}
            icon={option.icon}
            title={option.label}
            description={option.description}
          />
        ))}
      </View>
    </Shell>
  );
}

const SPACE_FEATURES: { label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  { label: 'Flow', icon: 'list-outline', description: 'Your everyday stream for photos, videos and thoughts.' },
  { label: 'Crushes', icon: 'heart-outline', description: 'A playful way to show romantic interest when the feeling is there.' },
  { label: 'Connections', icon: 'people-outline', description: 'Keep up with the people and creators you choose.' },
  { label: 'Circles', icon: 'albums-outline', description: 'Smaller communities built around shared interests.' },
  { label: 'Space', icon: 'person-circle-outline', description: 'Your home on HolUpp: your profile, your expression.' },
  { label: 'Moments', icon: 'camera-outline', description: 'Quick photos, videos and thoughts from the day.' },
];

/** 5 — a product tour, framed as a network rather than a dating funnel. */
export function OnboardingFeaturesScreen({ navigation }: ScreenProps<'OnboardingFeatures'>) {
  const { colors } = useTheme();
  return (
    <Shell step={5} title="Build your social space" subtitle="Everything has a place on HolUpp. Start broad, then find the rooms that feel like yours." onBack={() => navigation.goBack()} onNext={() => navigation.navigate('OnboardingComplete')} nextLabel="Keep going">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {SPACE_FEATURES.map((feature) => (
          <View key={feature.label} style={{ width: '48%', minHeight: 132, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }}>
              <Ionicons name={feature.icon} size={19} color={colors.primary} />
            </View>
            <Txt variant="bodyStrong" style={{ marginTop: space.sm }}>{feature.label}</Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>{feature.description}</Txt>
          </View>
        ))}
      </View>
      <View style={{ marginTop: rhythm.group, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryLine, flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ionicons name="globe-outline" size={20} color={colors.primary} style={{ marginTop: 1 }} />
        <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
          HolUpp is a place to share, discover and connect. Romantic relationships can grow here too — naturally, alongside everything else that makes a social network feel alive.
        </Txt>
      </View>
    </Shell>
  );
}

/** 6 — finish only after the required identity pieces are actually present. */
export function OnboardingCompleteScreen({ navigation }: ScreenProps<'OnboardingComplete'>) {
  const { colors } = useTheme();
  const { refresh } = useAuth();
  const toast = useToast();
  const [finishing, setFinishing] = useState(false);
  const { data: me } = useMe();

  const finish = async () => {
    setFinishing(true);
    try {
      await completeOnboarding();
      await refresh();
      toast({ kind: 'success', title: 'You’re on HolUpp', message: 'Your Space is ready. Discover something new.' });
    } catch (e) {
      setFinishing(false);
      toast({ kind: 'error', title: 'Almost there', message: (e as Error).message });
    }
  };

  return (
    <Shell step={6} title="You’re good to go!" subtitle="Your HolUpp experience starts here. Discover, express and find your people." onBack={() => navigation.goBack()} onNext={finish} nextLabel="Enter HolUpp" loading={finishing}>
      <View style={{ alignItems: 'center', paddingTop: space.md }}>
        <View style={{ width: 116, height: 116, borderRadius: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryLine }}>
          <Avatar uri={me?.profile.photos?.[0]?.url ?? null} name={me?.profile.name ?? 'You'} size={92} ring="crush" />
        </View>
        <Txt variant="heading" align="center" style={{ marginTop: space.lg }}>
          Your Space is ready for you.
        </Txt>
        <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: space.xs, maxWidth: 330 }}>
          Post something to Flow, explore Circles, share a Moment or simply look around. There is no single way to belong here.
        </Txt>
      </View>
      <View style={{ marginTop: rhythm.section, gap: space.xs }}>
        {['Discover what people are sharing.', 'Express yourself in the way that feels natural.', 'Build connections at your own pace.'].map((line) => (
          <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Txt variant="small" color="textSecondary">{line}</Txt>
          </View>
        ))}
      </View>
    </Shell>
  );
}
