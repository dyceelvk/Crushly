import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Glow } from '../../components/Ambient';
import { CrushlyMark } from '../../components/Logo';
import { Screen, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { UsernameField } from '../../components/UsernameField';
import { useSetUsername } from '../../api/hooks';
import { Chip, ChipGroup } from '../../components/Chip';
import { IconButton } from '../../components/IconButton';
import { PhotoGrid } from '../../components/PhotoGrid';
import { RangeSlider } from '../../components/Slider';
import { ListRow, Group } from '../../components/ListRow';
import { useToast } from '../../components/Toast';
import { useMe, useUpdatePreferences, useUpdatePrivacy, useUpdateProfile } from '../../api/hooks';
import { completeOnboarding } from '../../api/service';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { haptic } from '../../lib/haptics';
import { HIT, alpha, radius, rhythm, space, stroke } from '../../theme/tokens';
import { FILTER_INTENTIONS, INTENTIONS, INTERESTS, LANGUAGES, PRONOUNS, RELATIONSHIP_INTENTIONS, distanceLabel } from '../../lib/catalog';
import { getApproximateLocation } from '../../lib/media';
import type { Intention, Me } from '../../api/types';
import type { ScreenProps } from '../../navigation/types';

const TOTAL = 5;

/**
 * Where you are in the flow, as five segments rather than a bar.
 *
 * A single bar with a gradient on it answers "how far" but not "how many left",
 * and the gradient made the filled part ambiguous — a member cannot tell a
 * progress bar from decoration. Five segments answer both questions at a glance:
 * two filled means two done, three to go, whatever the screen is.
 */
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
 * The frame all five onboarding steps share.
 *
 * Replaces a header that stacked a back button, a gradient bar and a "1/5"
 * counter on one crowded line, with the title at whatever distance was left
 * over. Now: one app bar (escape on the left, progress in the middle, nothing
 * competing on the right), one headline block, the step's content, and a
 * hairline-separated footer holding the only forward action on screen.
 *
 * The steps are separate routes, so the navigator cuts between them. A short
 * entrance on the content closes that gap — the flow reads as one surface
 * changing rather than five pages loading. Honours Reduce Motion.
 */
function Shell({
  step, title, subtitle, children, onNext, nextLabel = 'Continue', nextDisabled, loading, onBack, skip,
}: {
  step: number; title: string; subtitle?: string; children: React.ReactNode; onNext: () => void; nextLabel?: string;
  nextDisabled?: boolean; loading?: boolean; onBack?: () => void; skip?: () => void;
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
      footer={
        <View>
          {/* The footer is where the only forward action lives, so it gets a
              hairline of its own instead of floating over the form. */}
          <View style={{ height: stroke.hairline, backgroundColor: colors.border, marginBottom: space.md }} />
          <Button title={nextLabel} onPress={onNext} disabled={nextDisabled} loading={loading} />
          {skip ? <Button title="Skip for now" variant="ghost" size="md" onPress={skip} /> : null}
        </View>
      }
    >
      <Glow size={520} color={colors.primary} opacity={0.22} style={{ position: 'absolute', top: -180, right: -220 }} />

      {/* App bar: one thing on the left, one on the right, nothing between
          them. Progress lives on its own line underneath, full width — squeezed
          between a back button and a counter it was neither centred nor
          readable, and the segments did not line up with anything. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm, minHeight: HIT }}>
        {onBack ? (
          <IconButton icon="chevron-back" label="Back" variant="plain" onPress={onBack} />
        ) : (
          /* No back on step one, so the left slot holds the mark — the same
             lockup that sits at the top of the account screens, which is what
             this flow follows directly. */
          <View style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}>
            <CrushlyMark size={22} />
          </View>
        )}
        {/* Signing out is a real escape hatch, but it sat where a back button
            normally sits, at the mouth of the flow's best conversion path, as a
            full 44pt filled icon button. As a quiet word on the right it is
            still there for someone who needs it and invisible to someone who
            does not. */}
        {!onBack ? (
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
          <Txt variant="label" color="textMuted">
            Step {step} of {TOTAL}
          </Txt>
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
            <Txt variant="body" color="textSecondary" style={{ marginTop: space.xs, maxWidth: 360 }}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <View style={{ marginTop: rhythm.section }}>{children}</View>
      </Animated.View>
    </Screen>
  );
}

/**
 * A labelled block inside a step: the label, the control, and the one line of
 * explanation that belongs to it. Grouping this way is what stops a long form
 * looking like an even list of unrelated boxes.
 */
function Section({ label, hint, error, children, first }: { label?: string; hint?: string; error?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <View style={{ marginTop: first ? 0 : rhythm.section }}>
      {label ? (
        <Txt variant="label" color="textSecondary" style={{ marginBottom: rhythm.tight }}>
          {label}
        </Txt>
      ) : null}
      {children}
      {error || hint ? (
        <Txt variant="small" color={error ? 'danger' : 'textMuted'} style={{ marginTop: rhythm.tight }}>
          {error || hint}
        </Txt>
      ) : null}
    </View>
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

/* 1 — What are you looking for? */
export function OnboardingIntentionsScreen({ navigation }: ScreenProps<'OnboardingIntentions'>) {
  const { colors } = useTheme();
  const { data: me } = useMe();
  const [selected, setSelected] = useState<Intention[]>(me?.profile.intentions || []);
  const { save, saving } = useSaver();
  const toggle = (v: Intention) => setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  return (
    <Shell
      step={1}
      title="What are you looking for?"
      subtitle="Choose as many as feel true. You can change this anytime."
      nextDisabled={!selected.length}
      loading={saving}
      onNext={async () => (await save({ intentions: selected })) && navigation.navigate('OnboardingBasics')}
    >
      <View style={{ gap: space.xs }}>
        {INTENTIONS.map((o) => {
          const on = selected.includes(o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                haptic.tap();
                toggle(o.value);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${o.label}. ${o.description}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingVertical: space.sm,
                paddingHorizontal: space.sm,
                borderRadius: radius.md,
                borderWidth: stroke.hairline,
                borderColor: on ? colors.primaryLine : colors.border,
                backgroundColor: on ? colors.primarySoft : colors.card,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? colors.primary : colors.elevated,
                }}
              >
                <Ionicons name={o.icon} size={18} color={on ? colors.onPrimary : colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{o.label}</Txt>
                <Txt variant="small" color="textSecondary" style={{ marginTop: 1 }}>
                  {o.description}
                </Txt>
              </View>
              {/* A drawn radio rather than an icon pair: the control stays the
                  same size in both states, so selecting a row does not make it
                  twitch, and it reads as one thing you can check. */}
              <View
                style={{
                  width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                  borderWidth: stroke.thick, borderColor: on ? colors.primary : colors.borderStrong,
                  backgroundColor: on ? colors.primary : 'transparent',
                }}
              >
                {on ? <Ionicons name="checkmark" size={13} color={colors.onPrimary} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Shell>
  );
}

/* 2 — Who are you? */
export function OnboardingBasicsScreen({ navigation }: ScreenProps<'OnboardingBasics'>) {
  const { data: me } = useMe();
  const toast = useToast();
  const p = me?.profile;
  const [name, setName] = useState(p?.name || '');
  const [bd] = useState(() => (p?.birthdate ? p.birthdate.split('-') : ['', '', '']));
  const [day, setDay] = useState(bd[2] || '');
  const [month, setMonth] = useState(bd[1] || '');
  const [year, setYear] = useState(bd[0] || '');
  const [pronouns, setPronouns] = useState(p?.pronouns || '');
  const [custom, setCustom] = useState(p?.pronouns && !PRONOUNS.includes(p.pronouns) ? p.pronouns : '');
  const [city, setCity] = useState(p?.city || '');
  const [username, setUsername] = useState(p?.username || '');
  const setHandle = useSetUsername();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { save, saving } = useSaver();
  const monthRef = React.useRef<TextInput>(null);
  const yearRef = React.useRef<TextInput>(null);

  const useLocation = async () => {
    setLocating(true);
    const res = await getApproximateLocation();
    setLocating(false);
    if ('error' in res) toast({ kind: 'info', title: 'Location not added', message: res.error });
    else {
      setLocation({ lat: res.lat, lng: res.lng });
      if (res.city && !city) setCity(res.city);
      toast({ kind: 'success', title: 'Approximate location added', message: 'Others only ever see a rounded distance.' });
    }
  };

  const next = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'What should we call you?';
    const d = Number(day), m = Number(month), y = Number(year);
    if (!d || !m || !y || year.length !== 4) e.birthday = 'Enter your full birthday.';
    const handle = username.trim().toLowerCase();
    if (!handle) e.username = 'Pick a username — it’s how people find you.';
    else if (!/^[a-z0-9_]{3,20}$/.test(handle)) e.username = 'Usernames are 3–20 characters: letters, numbers and underscores.';
    else if (!/[a-z]/.test(handle)) e.username = 'Use at least one letter.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const patch: Record<string, unknown> = {
      name: name.trim(),
      birthdate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      pronouns: custom.trim() || pronouns,
      city: city.trim(),
    };
    if (location) patch.location = location;
    if (!(await save(patch))) return;
    if (handle && handle !== (p?.username || '')) {
      try {
        await setHandle.mutateAsync(handle);
      } catch (err) {
        toast({ kind: 'error', title: 'Username not saved', message: (err as Error).message });
        return;
      }
    }
    navigation.navigate('OnboardingPhotos');
  };

  return (
    <Shell step={2} title="Who are you?" subtitle="The basics. Only your first name and age show on your Space." onBack={() => navigation.goBack()} onNext={next} loading={saving || setHandle.isPending}>
      <View>
        <View style={{ gap: rhythm.group }}>
          <Input label="First name" value={name} onChangeText={setName} placeholder="Your first name" autoComplete="given-name" textContentType="givenName" maxLength={30} error={errors.name} />
          <UsernameField value={username} onChange={setUsername} error={errors.username} />
        </View>
        <Section
          label="Birthday"
          error={errors.birthday}
          hint="Your birthday is private. We only show your age, and you can hide it later."
        >
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Input containerStyle={{ flex: 1 }} value={day} onChangeText={(t) => { setDay(t.replace(/\D/g, '').slice(0, 2)); if (t.length === 2) monthRef.current?.focus(); }} placeholder="DD" keyboardType="number-pad" maxLength={2} accessibilityLabel="Birth day" style={{ textAlign: 'center' }} />
            <Input ref={monthRef} containerStyle={{ flex: 1 }} value={month} onChangeText={(t) => { setMonth(t.replace(/\D/g, '').slice(0, 2)); if (t.length === 2) yearRef.current?.focus(); }} placeholder="MM" keyboardType="number-pad" maxLength={2} accessibilityLabel="Birth month" style={{ textAlign: 'center' }} />
            <Input ref={yearRef} containerStyle={{ flex: 1.5 }} value={year} onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))} placeholder="YYYY" keyboardType="number-pad" maxLength={4} accessibilityLabel="Birth year" style={{ textAlign: 'center' }} />
          </View>
        </Section>
        <Section label="Pronouns" hint="Optional. Pick a set or write your own.">
          <ChipGroup>
            {PRONOUNS.map((pr) => (
              <Chip key={pr} label={pr} selected={!custom && pronouns === pr} onPress={() => { setCustom(''); setPronouns(pronouns === pr ? '' : pr); }} />
            ))}
          </ChipGroup>
          <View style={{ marginTop: space.xs }}>
            <Input value={custom} onChangeText={setCustom} placeholder="Or write your own" maxLength={24} accessibilityLabel="Custom pronouns" />
          </View>
        </Section>
        <Section label="Where you are" hint="We never show your exact location — only a rounded distance like “5 km”, and you can hide that too.">
          <View style={{ gap: space.xs }}>
            <Input value={city} onChangeText={setCity} placeholder="City or neighbourhood" maxLength={60} icon="location-outline" accessibilityLabel="City or neighbourhood" />
            <Button
              title={location || me?.profile.hasLocation ? 'Approximate location added' : 'Use my approximate location'}
              icon={location || me?.profile.hasLocation ? 'checkmark-circle' : 'navigate-outline'}
              variant="secondary"
              size="md"
              loading={locating}
              onPress={useLocation}
            />
          </View>
        </Section>
      </View>
    </Shell>
  );
}

/* 3 — Photos */
export function OnboardingPhotosScreen({ navigation }: ScreenProps<'OnboardingPhotos'>) {
  const { colors } = useTheme();
  const { data: me } = useMe();
  const { contentWidth, gutter } = useLayout();
  const photos = me?.profile.photos || [];
  return (
    <Shell
      step={3}
      title="Show your world."
      subtitle="Add at least one photo. Three or more feels like you — your face, your places, your people."
      onBack={() => navigation.goBack()}
      onNext={() => navigation.navigate('OnboardingAbout')}
      nextDisabled={!photos.length}
      nextLabel={photos.length ? 'Continue' : 'Add a photo to continue'}
    >
      <PhotoGrid photos={photos} width={contentWidth - gutter * 2} />
      <View style={{ marginTop: rhythm.group, gap: space.xs }}>
        {['Clear, recent photos of your face get the most Crushes.', 'No nudity or other people’s photos — keep it classy.', 'Tap a photo to make it your main one or remove it.'].map((tip) => (
          <View key={tip} style={{ flexDirection: 'row', gap: space.xs }}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} style={{ marginTop: 2 }} />
            <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
              {tip}
            </Txt>
          </View>
        ))}
      </View>
    </Shell>
  );
}

/* 4 — About you */
export function OnboardingAboutScreen({ navigation }: ScreenProps<'OnboardingAbout'>) {
  const { data: me } = useMe();
  const p = me?.profile;
  const [bio, setBio] = useState(p?.bio || '');
  const [interests, setInterests] = useState<string[]>(p?.interests || []);
  const [rel, setRel] = useState(p?.relationshipIntention || '');
  const [langs, setLangs] = useState<string[]>(p?.languages || []);
  const { save, saving } = useSaver();
  const toggle = (list: string[], set: (v: string[]) => void, v: string, max: number) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : list.length >= max ? list : [...list, v]);

  return (
    <Shell
      step={4}
      title="Tell them about you"
      subtitle="A little personality goes a long way."
      onBack={() => navigation.goBack()}
      loading={saving}
      onNext={async () => (await save({ bio, interests, relationshipIntention: rel || null, languages: langs })) && navigation.navigate('OnboardingPreferences')}
    >
      <Input label="Bio" value={bio} onChangeText={setBio} multiline maxLength={500} showCount placeholder="What should someone know before saying hello?" />
      <Section label={`Interests · ${interests.length}/10`} hint={interests.length >= 10 ? 'That is the maximum — remove one to swap it out.' : 'Pick up to ten. These are what people search by.'}>
        <ChipGroup>
          {INTERESTS.map((i) => (
            <Chip key={i} label={i} selected={interests.includes(i)} onPress={() => toggle(interests, setInterests, i, 10)} />
          ))}
        </ChipGroup>
      </Section>
      <Section label="Relationship intention">
        <ChipGroup>
          {RELATIONSHIP_INTENTIONS.map((r) => (
            <Chip key={r} label={r} selected={rel === r} onPress={() => setRel(rel === r ? '' : r)} />
          ))}
        </ChipGroup>
      </Section>
      <Section label="Languages" hint="Optional. Up to six.">
        <ChipGroup>
          {LANGUAGES.map((l) => (
            <Chip key={l} label={l} size="sm" selected={langs.includes(l)} onPress={() => toggle(langs, setLangs, l, 6)} />
          ))}
        </ChipGroup>
      </Section>
    </Shell>
  );
}

/* 5 — Preferences */
export function OnboardingPreferencesScreen({ navigation }: ScreenProps<'OnboardingPreferences'>) {
  const { data: me } = useMe();
  const toast = useToast();
  const prefs = me?.preferences;
  const [ages, setAges] = useState<[number, number]>([prefs?.ageMin ?? 18, prefs?.ageMax ?? 45]);
  const [distance, setDistance] = useState(prefs?.maxDistance ?? 50);
  const [intentions, setIntentions] = useState<Intention[]>(prefs?.intentions ?? []);
  const [interests, setInterests] = useState<string[]>(prefs?.interests ?? []);
  const [showOnline, setShowOnline] = useState(me?.privacy.showOnline ?? true);
  const [discoverable, setDiscoverable] = useState(me?.privacy.discoverable ?? true);
  const [finishing, setFinishing] = useState(false);
  const updatePrefs = useUpdatePreferences();
  const updatePrivacy = useUpdatePrivacy();
  const { refresh } = useAuth();

  useEffect(() => {
    if (me?.profile.age && !prefs) setAges([Math.max(18, me.profile.age - 6), Math.min(99, me.profile.age + 10)]);
  }, [me, prefs]);

  const finish = async () => {
    setFinishing(true);
    try {
      await updatePrefs.mutateAsync({ ageMin: ages[0], ageMax: ages[1], maxDistance: distance, intentions, interests, verifiedOnly: false });
      await updatePrivacy.mutateAsync({ showOnline, discoverable });
      await completeOnboarding();
      await refresh(); // flips the navigator to the main app
      toast({ kind: 'success', title: 'Welcome to Crushly', message: 'Your Space is live. Find someone worth knowing.' });
    } catch (e) {
      setFinishing(false);
      toast({ kind: 'error', title: 'Almost there', message: (e as Error).message });
    }
  };

  const distanceSteps = [5, 10, 25, 50, 100, 200, 0];
  const distanceIndex = Math.max(0, distanceSteps.indexOf(distance));

  return (
    <Shell step={5} title="Your preferences" subtitle="Who would you like to discover? Adjust anytime from Discover." onBack={() => navigation.goBack()} onNext={finish} nextLabel="Start discovering" loading={finishing}>
      {/* The live value sits on the same line as its label, right-aligned, in
          tabular figures — so dragging a thumb changes digits in place instead
          of shifting the whole row sideways. */}
      <View style={{ gap: rhythm.tight }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Txt variant="label" color="textSecondary">
            Age
          </Txt>
          <Txt variant="numeric" color="primary">
            {ages[0]}–{ages[1] >= 99 ? '99+' : ages[1]}
          </Txt>
        </View>
        <RangeSlider min={18} max={99} low={ages[0]} high={ages[1]} onChange={(l, h) => setAges([l, h])} label="Age range" />
      </View>
      <View style={{ gap: rhythm.tight, marginTop: rhythm.group }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Txt variant="label" color="textSecondary">
            Distance
          </Txt>
          <Txt variant="numeric" color="primary">
            {distanceLabel(distance)}
          </Txt>
        </View>
        <RangeSlider min={0} max={distanceSteps.length - 1} low={distanceIndex} onChange={(l) => setDistance(distanceSteps[l])} label="Distance" formatValue={(i) => distanceLabel(distanceSteps[i])} />
      </View>
      <Section label="Connection type" hint="Leave it on “Open to anything” to see everyone.">
        <ChipGroup>
          <Chip label="Open to anything" selected={!intentions.length} onPress={() => setIntentions([])} />
          {FILTER_INTENTIONS.map((o) => (
            <Chip key={o.value} label={o.label} selected={intentions.includes(o.value)} onPress={() => setIntentions((s) => (s.includes(o.value) ? s.filter((x) => x !== o.value) : [...s, o.value]))} />
          ))}
        </ChipGroup>
      </Section>
      <Section label="Interests to prioritise" hint="Optional. People who share these come first.">
        <ChipGroup>
          {INTERESTS.slice(0, 12).map((i) => (
            <Chip key={i} label={i} size="sm" selected={interests.includes(i)} onPress={() => setInterests((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))} />
          ))}
        </ChipGroup>
      </Section>
      <Group title="Privacy" style={{ marginTop: rhythm.section }} footer="You’re always in control. Change these anytime in Privacy.">
        <ListRow title="Show when I’m online" subtitle="If off, you won’t see others’ status either" icon="radio-button-on-outline" iconTone="success" toggle={{ value: showOnline, onChange: setShowOnline }} />
        <ListRow title="Show me in Discover" subtitle="Turn off to browse privately; Crushes you send still arrive" icon="eye-outline" iconTone="gold" toggle={{ value: discoverable, onChange: setDiscoverable }} last />
      </Group>
    </Shell>
  );
}
