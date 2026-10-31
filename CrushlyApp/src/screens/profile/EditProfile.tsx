import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { UsernameField } from '../../components/UsernameField';
import { Button } from '../../components/Button';
import { Chip, ChipGroup } from '../../components/Chip';
import { PhotoGrid } from '../../components/PhotoGrid';
import { ProgressBar, LoadingBlock } from '../../components/States';
import { ListRow, Group } from '../../components/ListRow';
import { ConfirmSheet } from '../../components/BottomSheet';
import { useToast } from '../../components/Toast';
import { useMe, useSetUsername, useUpdateProfile } from '../../api/hooks';
import { INTENTIONS, INTERESTS, LANGUAGES, LIFESTYLE, PRONOUNS, RELATIONSHIP_INTENTIONS } from '../../lib/catalog';
import { birthdayLabel, capMessage, formAfterSave, formFromMe, formKey, isDirty, type ProfileForm } from '../../lib/profileForm';
import { getApproximateLocation } from '../../lib/media';
import { space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

type Form = ProfileForm;

const MAX_INTERESTS = 10;
const MAX_LANGUAGES = 6;

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xxl, gap: space.md }}>
      <View>
        <Txt variant="title" accessibilityRole="header">
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function EditProfileScreen({ navigation }: ScreenProps<'EditProfile'>) {
  const { data: me } = useMe();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const update = useUpdateProfile();
  const setHandle = useSetUsername();
  const [form, setForm] = useState<Form | null>(null);
  // What the server has, as a string. Seeded when the Space loads and re-seeded
  // after every successful save — see `lib/profileForm.ts` for why this is not
  // derived from the query on each render.
  const [baseline, setBaseline] = useState('');
  const [locating, setLocating] = useState(false);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const allowLeave = useRef(false);

  useEffect(() => {
    if (!me || form) return;
    const seed = formFromMe(me);
    setForm(seed);
    setBaseline(formKey(seed));
  }, [me, form]);

  const dirty = isDirty(form, baseline);

  // Guard against losing unsaved edits.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeave.current || !dirty || update.isPending) return;
      e.preventDefault();
      setLeaving(() => () => navigation.dispatch(e.data.action));
    });
    return sub;
  }, [navigation, dirty, update.isPending]);

  if (!me || !form) return <LoadingBlock label="Loading your Space" />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  /**
   * Add or remove one entry from a capped list.
   *
   * At the cap this used to return the list unchanged and say nothing, so the
   * eleventh interest was a dead tap — indistinguishable from a broken screen.
   * Turning a selection off still always works, so the cap is never a trap.
   */
  const toggle = <T,>(list: T[], v: T, max: number, what: string) => {
    if (list.includes(v)) return list.filter((x) => x !== v);
    if (list.length >= max) {
      toast({ kind: 'info', ...capMessage(what, max) });
      return list;
    }
    return [...list, v];
  };

  const save = async () => {
    if (!form.name.trim()) return toast({ kind: 'error', title: 'Your name can’t be empty' });
    const height = form.heightText ? Number(form.heightText) : undefined;
    if (height !== undefined && (!Number.isInteger(height) || height < 120 || height > 230)) {
      return toast({ kind: 'error', title: 'Check your height', message: 'Enter it in centimetres, between 120 and 230.' });
    }
    try {
      const next = await update.mutateAsync({
        name: form.name.trim(),
        pronouns: form.pronouns.trim(),
        city: form.city.trim(),
        bio: form.bio.trim(),
        intentions: form.intentions,
        relationshipIntention: form.relationshipIntention,
        interests: form.interests,
        languages: form.languages,
        lifestyle: { ...form.lifestyle, height, work: form.lifestyle.work?.trim() || undefined, education: form.lifestyle.education?.trim() || undefined },
      });
      // The handle is saved on its own: the database owns its rules, and a
      // taken or badly formed one shouldn't throw away everything else. What is
      // kept is what the database *returned* — it lowercases, trims and can
      // refuse — so the form never claims an @handle the server does not have.
      let handle = me.profile.username || '';
      const typed = form.username.trim().toLowerCase();
      if (typed !== handle) {
        try {
          handle = await setHandle.mutateAsync(typed);
        } catch (err) {
          toast({ kind: 'error', title: 'Username not changed', message: (err as Error).message });
        }
      }
      // Re-seeded from the server's copy *and* the confirmed handle, then marked
      // as the new baseline: saving is finished, so the footer goes away and
      // leaving no longer asks to discard work that was already saved.
      const saved = formAfterSave(next, handle);
      setForm(saved);
      setBaseline(formKey(saved));
      toast({ kind: 'success', title: 'Space saved' });
    } catch (e) {
      toast({ kind: 'error', title: 'Changes not saved', message: (e as Error).message });
    }
  };

  const updateLocation = async () => {
    setLocating(true);
    const res = await getApproximateLocation();
    setLocating(false);
    if ('error' in res) return toast({ kind: 'info', title: 'Location not updated', message: res.error });
    try {
      await update.mutateAsync({ location: { lat: res.lat, lng: res.lng }, ...(res.city && !form.city ? { city: res.city } : {}) });
      toast({ kind: 'success', title: 'Approximate location updated', message: 'Others only see a rounded distance.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Location not updated', message: (e as Error).message });
    }
  };

  const pct = me.completion.percent;

  return (
    <Screen keyboard footer={dirty ? <Button title="Save changes" onPress={save} loading={update.isPending || setHandle.isPending} /> : undefined}>
      <Header title="Edit Space" back />
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="smallStrong">Profile {pct}% complete</Txt>
          {me.completion.missing[0] ? (
            <Txt variant="small" color="textMuted" numberOfLines={1} style={{ flexShrink: 1, marginLeft: 8 }}>
              Next: {me.completion.missing[0]}
            </Txt>
          ) : null}
        </View>
        <ProgressBar value={pct / 100} label={`Space ${pct}% complete`} />
      </View>

      <Section title="Photos" subtitle="Show your world. Your first photo is the one people see first.">
        <PhotoGrid photos={me.profile.photos} width={contentWidth - gutter * 2} />
      </Section>

      <Section title="Basics">
        <Input label="First name" value={form.name} onChangeText={(t) => set('name', t)} maxLength={30} />
        <UsernameField value={form.username} onChange={(t) => set('username', t)} />
        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Pronouns
          </Txt>
          <ChipGroup>
            {PRONOUNS.map((p) => (
              <Chip key={p} label={p} selected={form.pronouns === p} onPress={() => set('pronouns', form.pronouns === p ? '' : p)} />
            ))}
          </ChipGroup>
          <Input value={PRONOUNS.includes(form.pronouns) ? '' : form.pronouns} onChangeText={(t) => set('pronouns', t)} placeholder="Or write your own" maxLength={24} accessibilityLabel="Custom pronouns" />
        </View>
        <Input label="City or neighbourhood" value={form.city} onChangeText={(t) => set('city', t)} maxLength={60} icon="location-outline" />
        <Button
          title={me.profile.hasLocation ? 'Refresh approximate location' : 'Use my approximate location'}
          icon="navigate-outline"
          variant="secondary"
          size="md"
          loading={locating}
          onPress={updateLocation}
        />
        <Txt variant="small" color="textMuted">
          Birthday: {birthdayLabel(me.profile.birthdate)} · Contact support if it’s wrong.
        </Txt>
      </Section>

      <Section title="About you" subtitle="A few honest lines go further than a perfect one.">
        <Input
          value={form.bio}
          onChangeText={(t) => set('bio', t)}
          placeholder="What makes a good day for you? What are you into right now?"
          multiline
          maxLength={500}
          showCount
          accessibilityLabel="Bio"
        />
        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Interests · {form.interests.length}/{MAX_INTERESTS}
          </Txt>
          <ChipGroup>
            {INTERESTS.map((i) => (
              <Chip key={i} label={i} size="sm" selected={form.interests.includes(i)} onPress={() => set('interests', toggle(form.interests, i, MAX_INTERESTS, 'interests'))} />
            ))}
          </ChipGroup>
        </View>
        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Languages · {form.languages.length}/{MAX_LANGUAGES}
          </Txt>
          <ChipGroup>
            {LANGUAGES.map((l) => (
              <Chip key={l} label={l} size="sm" selected={form.languages.includes(l)} onPress={() => set('languages', toggle(form.languages, l, MAX_LANGUAGES, 'languages'))} />
            ))}
          </ChipGroup>
        </View>
      </Section>

      <Section title="Dating" subtitle="Being clear saves everyone time.">
        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Looking for
          </Txt>
          <ChipGroup>
            {INTENTIONS.map((o) => (
              <Chip key={o.value} label={o.label} icon={o.icon} selected={form.intentions.includes(o.value)} onPress={() => set('intentions', toggle(form.intentions, o.value, INTENTIONS.length, 'intentions'))} />
            ))}
          </ChipGroup>
        </View>
        <View style={{ gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Relationship intention
          </Txt>
          <ChipGroup>
            {RELATIONSHIP_INTENTIONS.map((r) => (
              <Chip key={r} label={r} selected={form.relationshipIntention === r} onPress={() => set('relationshipIntention', form.relationshipIntention === r ? '' : r)} />
            ))}
          </ChipGroup>
        </View>
      </Section>

      <Section title="Lifestyle" subtitle="All optional. Share only what you want.">
        <Input label="Work" value={form.lifestyle.work ?? ''} onChangeText={(t) => set('lifestyle', { ...form.lifestyle, work: t })} placeholder="e.g. Architect" maxLength={60} icon="briefcase-outline" />
        <Input label="Education" value={form.lifestyle.education ?? ''} onChangeText={(t) => set('lifestyle', { ...form.lifestyle, education: t })} placeholder="e.g. UNILAG" maxLength={60} icon="school-outline" />
        <Input label="Height (cm)" value={form.heightText} onChangeText={(t) => set('heightText', t.replace(/\D/g, '').slice(0, 3))} placeholder="e.g. 180" keyboardType="number-pad" icon="resize-outline" />
        {LIFESTYLE.map((f) => (
          <View key={f.key} style={{ gap: 8 }}>
            <Txt variant="label" color="textSecondary">
              {f.label}
            </Txt>
            <ChipGroup>
              {f.options.map((o) => (
                <Chip key={o} label={o} size="sm" selected={form.lifestyle[f.key] === o} onPress={() => set('lifestyle', { ...form.lifestyle, [f.key]: form.lifestyle[f.key] === o ? undefined : o })} />
              ))}
            </ChipGroup>
          </View>
        ))}
      </Section>

      <Section title="Privacy">
        <Group>
          <ListRow title="Privacy & visibility" subtitle="Distance, online status, who can Whisper you" icon="eye-off-outline" onPress={() => navigation.navigate('Privacy')} />
          <ListRow
            title="Verification"
            value={{ verified: 'Verified', pending: 'In review', rejected: 'Try again', none: 'Not verified' }[me.verification.status]}
            icon="shield-checkmark-outline"
            iconTone="gold"
            onPress={() => navigation.navigate('Verification')}
            last
          />
        </Group>
      </Section>

      <ConfirmSheet
        visible={!!leaving}
        title="Discard your changes?"
        message="You have edits that haven’t been saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          const go = leaving;
          setLeaving(null);
          allowLeave.current = true;
          go?.();
        }}
        onCancel={() => setLeaving(null)}
      />
    </Screen>
  );
}
