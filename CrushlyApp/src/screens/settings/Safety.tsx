import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { ListRow, Group } from '../../components/ListRow';
import { Segmented } from '../../components/Segmented';
import { LoadingBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useMe, useUpdatePrivacy } from '../../api/hooks';
import type { Privacy } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

/* -------------------------------------------------------- safety center */

export function SafetyScreen({ navigation }: ScreenProps<'Safety'>) {
  const { colors } = useTheme();
  const { data: me } = useMe();
  const update = useUpdatePrivacy();
  const toast = useToast();
  const discoverable = me?.privacy.discoverable ?? true;

  const tools: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
    { icon: 'ban-outline', title: 'Cut Off', body: 'Open any Space or Whisper, tap ··· and choose Cut Off. They’re never told.' },
    { icon: 'flag-outline', title: 'Flag', body: 'Same menu. Flags are confidential and reviewed by a person.' },
    { icon: 'heart-dislike-outline', title: 'Unclick', body: 'Ends your Click and closes your Whisper.' },
  ];

  return (
    <Screen>
      <Header title="Safety center" subtitle="You’re in control of who sees you and who can reach you." back />

      <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.successSoft, flexDirection: 'row', gap: space.md, marginBottom: space.xl }}>
        <Ionicons name="shield-checkmark" size={26} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Txt variant="subheading">Your exact location is never shared</Txt>
          <Txt variant="small" color="textSecondary" style={{ marginTop: 4 }}>
            Members see a rounded distance at most. Your birthday, email and selfies stay private.
          </Txt>
        </View>
      </View>

      <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm, marginLeft: 4 }}>
        If someone makes you uncomfortable
      </Txt>
      <View style={{ gap: space.sm, marginBottom: space.xl }}>
        {tools.map((t) => (
          <View key={t.title} style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name={t.icon} size={20} color={colors.gold} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{t.title}</Txt>
              <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
                {t.body}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      <Group title="Quick controls">
        <ListRow
          title="Show me in Discover"
          subtitle={discoverable ? 'People Around can find you' : 'Hidden. Crushes you send still arrive.'}
          icon="eye-outline"
          toggle={{
            value: discoverable,
            onChange: (v) => update.mutate({ discoverable: v }, { onError: (e) => toast({ kind: 'error', title: 'Not saved', message: (e as Error).message }) }),
          }}
        />
        <ListRow title="People you’ve cut off" icon="ban-outline" onPress={() => navigation.navigate('BlockedUsers')} />
        <ListRow title="Privacy & visibility" icon="eye-off-outline" onPress={() => navigation.navigate('Privacy')} />
        <ListRow title="Account security" subtitle="Password, other devices" icon="key-outline" onPress={() => navigation.navigate('Account')} last />
      </Group>

      <Group title="Learn">
        <ListRow title="Dating safety tips" icon="bulb-outline" iconTone="gold" onPress={() => navigation.navigate('Info', { page: 'safety-tips' })} />
        <ListRow title="Community guidelines" icon="people-outline" onPress={() => navigation.navigate('Info', { page: 'guidelines' })} />
        <ListRow title="Contact our safety team" icon="mail-outline" onPress={() => navigation.navigate('Info', { page: 'contact' })} last />
      </Group>

      <Pressable onPress={() => navigation.navigate('Info', { page: 'safety-tips' })} accessibilityRole="button" style={{ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoft }}>
        <Txt variant="small" color="textSecondary">
          <Txt variant="smallStrong" color="danger">
            In danger right now?{' '}
          </Txt>
          Contact your local emergency services first — know the number for the area you are in.
        </Txt>
      </Pressable>
    </Screen>
  );
}

/* --------------------------------------------------------------- privacy */

export function PrivacyScreen({ navigation }: ScreenProps<'Privacy'>) {
  const { data: me } = useMe();
  const update = useUpdatePrivacy();
  const toast = useToast();
  if (!me) return <LoadingBlock />;
  const p = me.privacy;

  const set = (patch: Partial<Privacy>) =>
    update.mutate(patch, {
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'plus_required') {
          toast({ kind: 'info', title: 'Part of Crushly Plus', message: e.message, onPress: () => navigation.navigate('Plus', { feature: 'Incognito' }), duration: 5000 });
        } else toast({ kind: 'error', title: 'Not saved', message: (e as Error).message });
      },
    });

  return (
    <Screen>
      <Header title="Privacy & visibility" back />

      <Group title="Discovery" footer="When hidden, you won’t appear in Discover, but people you’ve crushed on can still see your Space.">
        <ListRow title="Show me in Discover" icon="compass-outline" toggle={{ value: p.discoverable, onChange: (v) => set({ discoverable: v }) }} />
        <ListRow title="Incognito" subtitle="Only people you Crush on can see you" icon="glasses-outline" iconTone="gold" value="Plus" toggle={{ value: p.incognito, onChange: (v) => set({ incognito: v }) }} last />
      </Group>

      <Group title="What others see" footer="Your exact location is never shown. Distance is always rounded.">
        <ListRow title="Show approximate distance" icon="navigate-outline" toggle={{ value: p.showDistance, onChange: (v) => set({ showDistance: v }) }} />
        <ListRow title="Show my age" icon="calendar-outline" toggle={{ value: p.showAge, onChange: (v) => set({ showAge: v }) }} />
        <ListRow title="Show my city" icon="business-outline" toggle={{ value: p.showCity, onChange: (v) => set({ showCity: v }) }} />
        <ListRow title="Show when I’m online" subtitle="If off, you won’t see others’ status either" icon="radio-button-on-outline" toggle={{ value: p.showOnline, onChange: (v) => set({ showOnline: v }) }} />
        <ListRow title="Read receipts" subtitle="If off, you won’t see others’ either" icon="checkmark-done-outline" toggle={{ value: p.readReceipts, onChange: (v) => set({ readReceipts: v }) }} last />
      </Group>

      <Choice
        title="Who can see my full Space"
        value={p.profileVisibility}
        onChange={(v) => set({ profileVisibility: v })}
        options={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'connections', label: 'Connections' },
        ]}
        footer={p.profileVisibility === 'connections' ? 'Others see your main photo and name only until you’re connected.' : undefined}
      />
      <Choice
        title="Who can Whisper me"
        value={p.whoCanMessage}
        onChange={(v) => set({ whoCanMessage: v })}
        options={[
          { value: 'mutual', label: 'Mutual Crushes' },
          { value: 'crushes', label: 'My crushes' },
          { value: 'everyone', label: 'Everyone' },
        ]}
        footer={{ mutual: 'Only people you both crushed on.', crushes: 'People you’ve crushed on can Whisper you first.', everyone: 'Anyone who can see your Space can start a Whisper.' }[p.whoCanMessage]}
      />
      <Choice
        title="Who can Crush on me"
        value={p.whoCanCrush}
        onChange={(v) => set({ whoCanCrush: v })}
        options={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'verified', label: 'Verified only' },
        ]}
      />
    </Screen>
  );
}

function Choice<T extends string>({ title, value, onChange, options, footer }: { title: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; footer?: string }) {
  return (
    <View style={{ marginBottom: space.xl }}>
      <Txt variant="label" color="textSecondary" style={{ marginBottom: space.xs, marginLeft: 4 }} accessibilityRole="header">
        {title}
      </Txt>
      <Segmented<T> value={value} onChange={onChange} options={options} />
      {footer ? (
        <Txt variant="small" color="textMuted" style={{ marginTop: space.xs, marginHorizontal: 4 }}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );
}
