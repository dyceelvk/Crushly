import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ListRow, Group } from '../../components/ListRow';
import { BottomSheet, ConfirmSheet } from '../../components/BottomSheet';
import { Avatar } from '../../components/Photo';
import { EmptyState, LoadingBlock } from '../../components/States';
import { Wordmark } from '../../components/Logo';
import { useToast } from '../../components/Toast';
import { keys, useBlocks, useMe, useUnblock, useUpdateNotificationSettings } from '../../api/hooks';
import * as service from '../../api/service';
import type { Me } from '../../api/types';
import { useAuth } from '../../state/auth';
import { useTheme, type Appearance } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgoLong } from '../../lib/format';
import { COMPANY_NAME } from '../../lib/company';
import type { ScreenProps } from '../../navigation/types';

/* ------------------------------------------------------------------ hub */

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { data: me } = useMe();
  const { signOut } = useAuth();
  const { appearance } = useTheme();
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen>
      <Header title="Settings" back />
      <Group title="Account">
        <ListRow title="Account & security" subtitle={me?.email} icon="person-circle-outline" onPress={() => navigation.navigate('Account')} />
        <ListRow title="Edit profile" icon="create-outline" onPress={() => navigation.navigate('EditProfile')} />
        <ListRow
          title="Verification"
          value={{ verified: 'Verified', pending: 'In review', rejected: 'Try again', none: 'Not verified' }[me?.verification.status ?? 'none']}
          icon="shield-checkmark-outline"
          iconTone="gold"
          onPress={() => navigation.navigate('Verification')}
        />
        <ListRow title="Crushly Plus" value={me?.plus.interested ? 'On the list' : 'Coming soon'} icon="sparkles-outline" iconTone="gold" onPress={() => navigation.navigate('Plus', {})} last />
      </Group>

      <Group title="Discovery & privacy">
        <ListRow title="Discover preferences" subtitle="Age, distance, what you’re looking for" icon="options-outline" onPress={() => navigation.navigate('Filters')} />
        <ListRow title="Privacy & visibility" subtitle="Distance, online status, who can reach you" icon="eye-off-outline" onPress={() => navigation.navigate('Privacy')} last />
      </Group>

      <Group title="Safety">
        <ListRow title="Safety center" subtitle="Block, report, and stay in control" icon="shield-outline" iconTone="success" onPress={() => navigation.navigate('Safety')} />
        <ListRow title="Blocked members" icon="ban-outline" onPress={() => navigation.navigate('BlockedUsers')} last />
      </Group>

      <Group title="App">
        <ListRow title="Notifications" icon="notifications-outline" onPress={() => navigation.navigate('NotificationSettings')} />
        <ListRow title="Appearance" value={{ dark: 'Dark', light: 'Light', system: 'System' }[appearance]} icon="contrast-outline" onPress={() => navigation.navigate('Appearance')} last />
      </Group>

      <Group title="Support">
        <ListRow title="Help center" icon="help-circle-outline" onPress={() => navigation.navigate('Info', { page: 'help' })} />
        <ListRow title="Contact us" icon="mail-outline" onPress={() => navigation.navigate('Info', { page: 'contact' })} />
        <ListRow title="Community guidelines" icon="people-outline" onPress={() => navigation.navigate('Info', { page: 'guidelines' })} />
        <ListRow title="Privacy policy" icon="lock-closed-outline" onPress={() => navigation.navigate('Info', { page: 'privacy' })} />
        <ListRow title="Terms of service" icon="document-text-outline" onPress={() => navigation.navigate('Info', { page: 'terms' })} last />
      </Group>

      <Button title="Sign out" variant="secondary" onPress={() => setConfirmOut(true)} style={{ marginTop: space.xl }} />
      <View style={{ alignItems: 'center', marginTop: space.xl, gap: 4 }}>
        <Wordmark size={18} />
        <Txt variant="caption" color="textMuted">
          Version {version}
        </Txt>
        <Txt variant="caption" color="textMuted">
          A {COMPANY_NAME} product
        </Txt>
      </View>

      <ConfirmSheet
        visible={confirmOut}
        title="Sign out of Crushly?"
        message="Your profile stays exactly as it is. Sign back in anytime."
        confirmLabel="Sign out"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          await signOut();
        }}
        onCancel={() => setConfirmOut(false)}
      />
    </Screen>
  );
}

/* -------------------------------------------------------------- account */

export function AccountScreen({ navigation }: ScreenProps<'Account'>) {
  const { data: me } = useMe();
  const { forget } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<null | 'email' | 'password' | 'delete'>(null);
  const [current, setCurrent] = useState('');
  const [email, setEmail] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const close = () => {
    setSheet(null);
    setCurrent('');
    setEmail('');
    setNext('');
    setError(null);
  };

  const account = useMutation({
    mutationFn: (body: { currentPassword: string; email?: string; newPassword?: string }) => service.updateAccount(body),
    onSuccess: (m, body) => {
      qc.setQueryData(keys.me, m.me);
      close();
      toast({
        kind: 'success',
        title: body.email ? (m.emailPending ? 'Confirm your new email' : 'Email updated') : 'Password changed',
        message: m.emailPending
          ? 'We sent confirmation links to both addresses. It activates once you confirm.'
          : body.newPassword
            ? 'Other devices have been signed out.'
            : undefined,
      });
    },
    onError: (e) => setError((e as Error).message),
  });
  const status = useMutation({
    mutationFn: (s: 'active' | 'paused') => service.setStatus(s),
    onSuccess: (m) => {
      qc.setQueryData(keys.me, m);
      qc.invalidateQueries({ queryKey: keys.discover });
      setConfirmPause(false);
      toast({ kind: 'success', title: m.status === 'paused' ? 'Profile hidden' : 'You’re visible again', message: m.status === 'paused' ? 'You won’t appear in Discover. Your chats stay open.' : undefined });
    },
    onError: (e) => toast({ kind: 'error', title: 'Not updated', message: (e as Error).message }),
  });
  const revoke = useMutation({
    mutationFn: () => service.signOutOtherSessions(),
    onSuccess: () => {
      setConfirmRevoke(false);
      toast({ kind: 'success', title: 'Signed out everywhere else' });
    },
    onError: (e) => toast({ kind: 'error', title: 'Something went wrong', message: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: () => service.deleteAccount(current),
    onSuccess: async () => {
      close();
      await forget();
    },
    onError: (e) => setError((e as Error).message),
  });

  if (!me) return <LoadingBlock />;
  const paused = me.status === 'paused';

  return (
    <Screen>
      <Header title="Account & security" back />
      <Group title="Sign-in">
        <ListRow title="Email" value={me.email} icon="mail-outline" onPress={() => setSheet('email')} />
        <ListRow title="Change password" icon="key-outline" onPress={() => setSheet('password')} />
        <ListRow title="Sign out of other devices" icon="phone-portrait-outline" onPress={() => setConfirmRevoke(true)} last />
      </Group>
      <Group title="Visibility" footer="Hiding your profile takes you out of Discover. Your Connections and conversations stay.">
        <ListRow
          title="Hide my profile"
          icon="moon-outline"
          toggle={{ value: paused, onChange: (v) => (v ? setConfirmPause(true) : status.mutate('active')) }}
          last
        />
      </Group>
      <Group title="Danger zone">
        <ListRow title="Delete account" subtitle="Permanently removes your profile, photos and messages" icon="trash-outline" destructive onPress={() => setSheet('delete')} last />
      </Group>
      <Txt variant="caption" color="textMuted">
        Member since {new Date(me.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      </Txt>

      <BottomSheet
        visible={sheet === 'email' || sheet === 'password'}
        onClose={close}
        title={sheet === 'email' ? 'Change email' : 'Change password'}
        footer={
          <Button
            title="Save"
            loading={account.isPending}
            onPress={() => account.mutate(sheet === 'email' ? { currentPassword: current, email } : { currentPassword: current, newPassword: next })}
          />
        }
      >
        <View style={{ gap: space.md }}>
          {sheet === 'email' ? (
            <Input label="New email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          ) : (
            <Input label="New password" value={next} onChangeText={setNext} secureTextEntry hint="At least 8 characters" autoComplete="new-password" />
          )}
          <Input label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" error={error} />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sheet === 'delete'}
        onClose={close}
        title="Delete your account?"
        subtitle="This can’t be undone. Your profile, photos, Moments, Crushes and messages will be permanently deleted."
        footer={<Button title="Delete permanently" variant="danger" loading={remove.isPending} disabled={!current} onPress={() => remove.mutate()} />}
      >
        <View style={{ gap: space.md }}>
          <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.goldSoft }}>
            <Txt variant="small">Just need a break? You can hide your profile instead and come back anytime.</Txt>
          </View>
          <Input label="Enter your password to confirm" value={current} onChangeText={setCurrent} secureTextEntry error={error} />
        </View>
      </BottomSheet>

      <ConfirmSheet
        visible={confirmPause}
        title="Hide your profile?"
        message="You won’t appear in Discover and people can’t Crush on you. Your existing conversations stay open."
        confirmLabel="Hide profile"
        loading={status.isPending}
        onConfirm={() => status.mutate('paused')}
        onCancel={() => setConfirmPause(false)}
      />
      <ConfirmSheet
        visible={confirmRevoke}
        title="Sign out other devices?"
        message="Anyone signed in to your account elsewhere will be signed out. This device stays signed in."
        confirmLabel="Sign them out"
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate()}
        onCancel={() => setConfirmRevoke(false)}
      />
    </Screen>
  );
}

/* -------------------------------------------------------- notifications */

export function NotificationSettingsScreen() {
  const { data: me } = useMe();
  const update = useUpdateNotificationSettings();
  const toast = useToast();
  if (!me) return <LoadingBlock />;
  const n = me.notifications;
  const set = (k: keyof typeof n) => (v: boolean) =>
    update.mutate({ [k]: v }, { onError: (e) => toast({ kind: 'error', title: 'Not saved', message: (e as Error).message }) });
  return (
    <Screen>
      <Header title="Notifications" back />
      <Group footer="These control your in-app notification center. Push notifications arrive in a future update.">
        <ListRow title="Messages" subtitle="New messages from your Connections" icon="chatbubble-outline" toggle={{ value: n.messages, onChange: set('messages') }} />
        <ListRow title="Crushes" subtitle="Crushes, Deep Crushes and Mutual Crushes" icon="heart-outline" toggle={{ value: n.crushes, onChange: set('crushes') }} />
        <ListRow title="Moments" subtitle="Replies and reactions to your Moments" icon="aperture-outline" toggle={{ value: n.moments, onChange: set('moments') }} />
        <ListRow title="Discoveries" subtitle="Occasional suggestions of people worth knowing" icon="compass-outline" toggle={{ value: n.recommendations, onChange: set('recommendations') }} last />
      </Group>
    </Screen>
  );
}

/* ----------------------------------------------------------- appearance */

export function AppearanceScreen() {
  const { appearance, setAppearance, colors } = useTheme();
  const options: { value: Appearance; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'dark', label: 'Dark', description: 'The signature Crushly look.', icon: 'moon-outline' },
    { value: 'light', label: 'Light', description: 'Warm ivory, for daylight.', icon: 'sunny-outline' },
    { value: 'system', label: 'System', description: 'Follow your device setting.', icon: 'phone-portrait-outline' },
  ];
  return (
    <Screen>
      <Header title="Appearance" back />
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = appearance === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => setAppearance(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: on ? colors.goldLine : colors.border }}
            >
              <Ionicons name={o.icon} size={22} color={on ? colors.gold : colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{o.label}</Txt>
                <Txt variant="small" color="textSecondary">
                  {o.description}
                </Txt>
              </View>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.gold : colors.borderStrong} />
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

/* --------------------------------------------------------------- blocked */

export function BlockedUsersScreen() {
  const { data, isLoading } = useBlocks();
  const unblock = useUnblock();
  const toast = useToast();
  const [target, setTarget] = useState<{ id: number; name: string } | null>(null);
  return (
    <Screen>
      <Header title="Blocked members" subtitle="They can’t see you, Crush on you or message you." back />
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <EmptyState icon="ban-outline" title="No one blocked" message="If someone makes you uncomfortable, you can block them from their profile or your chat." />
      ) : (
        <Group>
          {data.map((b, i) => (
            <ListRow
              key={b.id}
              title={b.name}
              subtitle={`Blocked ${timeAgoLong(b.blockedAt)}`}
              trailing={<Button title="Unblock" size="sm" variant="secondary" onPress={() => setTarget(b)} />}
              leading={<Avatar uri={b.photo} name={b.name} size={40} />}
              last={i === data.length - 1}
            />
          ))}
        </Group>
      )}
      <ConfirmSheet
        visible={!!target}
        title={`Unblock ${target?.name}?`}
        message="They may see you in Discover again. Your previous Crushes and conversation won’t come back."
        confirmLabel="Unblock"
        loading={unblock.isPending}
        onConfirm={() =>
          target &&
          unblock.mutate(target.id, {
            onSuccess: () => {
              toast({ kind: 'success', title: `${target.name} unblocked` });
              setTarget(null);
            },
            onError: (e) => toast({ kind: 'error', title: 'Couldn’t unblock', message: (e as Error).message }),
          })
        }
        onCancel={() => setTarget(null)}
      />
    </Screen>
  );
}
