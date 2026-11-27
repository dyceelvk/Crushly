import React, { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Linking } from 'react-native';
import { useAppUpdate } from '../../api/hooks';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ListRow, Group } from '../../components/ListRow';
import { BottomSheet, ConfirmSheet } from '../../components/BottomSheet';
import { Avatar } from '../../components/Photo';
import { useProfileTap } from '../../lib/useProfileTap';
import { playSound, setSoundEnabled, soundEnabled, whenSoundSettingLoaded } from '../../lib/sound';
import { alertPermission, requestAlertPermission } from '../../lib/systemAlert';
import { SOUND_CHOICES, soundName } from '../../lib/soundChoices';
import { setSoundChoice, soundChoice } from '../../lib/sound';
import { ActionSheet } from '../../components/BottomSheet';
import { EmptyState, LoadingBlock } from '../../components/States';
import { Wordmark } from '../../components/Logo';
import { useToast } from '../../components/Toast';
import { keys, useBlocks, useMe, useUnblock, useUpdateNotificationSettings, useIsHolupAdmin } from '../../api/hooks';
import * as service from '../../api/service';
import type { Me } from '../../api/types';
import { useAuth } from '../../state/auth';
import { useTheme, type Appearance } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { timeAgoLong } from '../../lib/format';
import { errorLine } from '../../lib/errors';
import { COMPANY_CONTACT_EMAIL, COMPANY_NAME, COMPANY_SITE, OWNERSHIP_EXPLANATION, OWNERSHIP_SENTENCE, SUPPORT_EMAIL } from '../../lib/company';
import { companyRow, openOutside, visitCompanyRow } from '../../lib/companyLinks';
import { androidUpdateStatus } from '../../lib/updateDisplay';
import { requestHolupUpdate } from '../../components/UpdateGate';
import type { ScreenProps } from '../../navigation/types';

/* ------------------------------------------------------------------ hub */

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { data: me } = useMe();
  const { data: isAdmin } = useIsHolupAdmin();
  const { signOut } = useAuth();
  const { appearance } = useTheme();
  const toast = useToast();
  const [confirmOut, setConfirmOut] = useState(false);
  /* "Who owns holUpp?" — the question, answered on the screen it is asked from. */
  const [whoOwns, setWhoOwns] = useState(false);
  /* Null when no company website is configured — the rows simply do not appear,
     rather than opening a browser on a domain nobody controls. */
  const company = companyRow();
  const visit = visitCompanyRow();
  const [busy, setBusy] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const versionCode = Number(Constants.expoConfig?.android?.versionCode ?? 0);
  // Asked against our own Worker, never against GitHub: a member should never
  // be handed a link into the machinery.
  const update = useAppUpdate(versionCode);
  const updateStatus = androidUpdateStatus({ loading: update.isFetching, error: update.isError, hasData: !!update.data, available: !!update.data?.available });

  /* The signed resolver must succeed before Android receives a package URL.
     A download button that silently does nothing is worse than a clear answer. */
  const openUpdate = async () => {
    const available = update.data;
    if (!available?.apkUrl) {
      toast({
        kind: 'info',
        title: 'No build published yet',
        message: update.isFetching ? 'Still asking for the latest build. Try again in a moment.' : 'The Android build isn’t published to the update server yet.',
      });
      return;
    }
    try {
      // The resolver gives us a fresh GitHub CDN link before Android opens the
      // package. A transient Worker/GitHub failure is shown as a sentence here,
      // never saved as JSON with an .apk filename for the installer to parse.
      if (available.downloadInfoUrl) {
        const response = await fetch(available.downloadInfoUrl);
        const payload = (await response.json().catch(() => null)) as { downloadUrl?: unknown } | null;
        if (!response.ok || typeof payload?.downloadUrl !== 'string') {
          throw new Error('The download is not ready yet. Please try again shortly.');
        }
        await Linking.openURL(payload.downloadUrl);
        return;
      }
      await Linking.openURL(available.apkUrl);
    } catch (error) {
      toast({ kind: 'error', title: 'Download unavailable', message: error instanceof Error ? error.message : 'Please try again shortly.' });
    }
  };

  return (
    <Screen>
      <Header title="Settings" back />
      {isAdmin ? <Group title="Administration"><ListRow title="holUpp admin" subtitle="Features and announcements" icon="settings-outline" onPress={() => navigation.navigate('Admin')} last /></Group> : null}
      <Group title="Account">
        <ListRow title="Account & security" subtitle={me?.email} icon="person-circle-outline" onPress={() => navigation.navigate('Account')} />
        <ListRow
          title="Verification"
          value={{ verified: 'Verified', pending: 'In review', rejected: 'Try again', none: 'Not verified' }[me?.verification.status ?? 'none']}
          icon="shield-checkmark-outline"
          iconTone="gold"
          onPress={() => navigation.navigate('Verification')}
        />
        <ListRow title="holUpp Plus" value={me?.plus.interested ? 'On the list' : 'Coming soon'} icon="sparkles-outline" iconTone="gold" onPress={() => navigation.navigate('Plus', {})} />
        <ListRow title="Invite people" subtitle="Share holUpp and see your private referral progress" icon="person-add-outline" iconTone="success" onPress={() => navigation.navigate('Invite')} last />
      </Group>

      <Group title="Discovery & privacy">
        <ListRow title="Discover preferences" subtitle="Age, distance, what you’re looking for" icon="options-outline" onPress={() => navigation.navigate('Filters')} />
        <ListRow title="Privacy & visibility" subtitle="Distance, online status, who can reach you" icon="eye-off-outline" onPress={() => navigation.navigate('Privacy')} last />
      </Group>

      <Group title="Safety">
        <ListRow title="Safety center" subtitle="Cut off, flag, and stay in control" icon="shield-outline" iconTone="success" onPress={() => navigation.navigate('Safety')} />
        <ListRow title="People you’ve cut off" icon="ban-outline" onPress={() => navigation.navigate('BlockedUsers')} last />
      </Group>

      <Group title="Support">
        <ListRow title="Ask RielAi" subtitle="Quick answers about using holUpp" icon="sparkles-outline" iconTone="gold" onPress={() => navigation.navigate('RielAi')} />
        <ListRow title="Report a problem" subtitle="Send product or account details to support" icon="flag-outline" onPress={() => navigation.navigate('Support', { source: 'settings' })} last />
      </Group>

      {/* One section, not two both called "App". The version and the update
          status belong with the rest of the app settings; the footer below used
          to state the version a second time. */}
      <Group title="App">
        <ListRow title="Notification settings" icon="notifications-outline" onPress={() => navigation.navigate('NotificationSettings')} />
        <ListRow title="Appearance" value={{ dark: 'Dark', light: 'Light', system: 'System' }[appearance]} icon="contrast-outline" onPress={() => navigation.navigate('Appearance')} />
        <ListRow
          title="App version"
          subtitle={Platform.OS === 'android' && versionCode ? `Android build ${versionCode}` : undefined}
          value={version}
          icon="information-circle-outline"
          last={Platform.OS !== 'android' && Platform.OS !== 'web'}
        />
        {Platform.OS === 'web' ? (
          <ListRow
            title="Download the app"
            subtitle={update.data?.version ? `holUpp for Android · APK ${update.data.version}` : 'holUpp for Android · APK'}
            value={update.data?.apkUrl ? 'APK' : undefined}
            icon="download-outline"
            iconTone="gold"
            onPress={() => { void openUpdate(); }}
            last
          />
        ) : Platform.OS === 'android' && updateStatus === 'available' ? (
          <ListRow
            title="Update holUpp"
            subtitle={update.data?.notes || `Version ${update.data?.version} is ready to install.`}
            value={update.data?.version}
            icon="download-outline"
            onPress={requestHolupUpdate}
            last
          />
        ) : Platform.OS === 'android' && updateStatus === 'current' ? (
          <ListRow title="You’re up to date" subtitle="holUpp checks every few hours." icon="checkmark-circle-outline" last />
        ) : Platform.OS === 'android' && updateStatus === 'checking' ? (
          <ListRow title="Checking for updates…" icon="refresh-outline" last />
        ) : Platform.OS === 'android' ? (
          <ListRow title="Couldn’t check for updates" subtitle="Tap to try again." icon="refresh-outline" onPress={() => { void update.refetch(); }} last />
        ) : null}
      </Group>

      <Group title="Support">
        <ListRow title="Help center" icon="help-circle-outline" onPress={() => navigation.navigate('Info', { page: 'help' })} />
        <ListRow title="Contact us" icon="mail-outline" onPress={() => navigation.navigate('Info', { page: 'contact' })} />
        <ListRow title="Community guidelines" icon="people-outline" onPress={() => navigation.navigate('Info', { page: 'guidelines' })} />
        <ListRow title="Privacy policy" icon="lock-closed-outline" onPress={() => navigation.navigate('Info', { page: 'privacy' })} />
        <ListRow title="Terms of service" icon="document-text-outline" onPress={() => navigation.navigate('Info', { page: 'terms' })} last />
      </Group>

      {/*
        Who makes this app, said where people look for it.

        A product that names no company reads as either a hobby or something to
        be suspicious of, and people look for this in Settings before they look
        anywhere else — it is where every app they already trust puts it. Three
        rows, and then the same sentence again under the wordmark where the eye
        lands anyway.
      */}
      <Group title="Company" footer={OWNERSHIP_SENTENCE}>
        {company ? (
          <ListRow
            title={company.title}
            subtitle={company.subtitle}
            icon="business-outline"
            accessibilityHint={`Opens ${COMPANY_SITE} in your browser`}
            onPress={() => void openOutside(company.url)}
          />
        ) : null}
        <ListRow
          title="Who owns holUpp?"
          subtitle={`${COMPANY_NAME} does — tap to read how`}
          icon="information-circle-outline"
          onPress={() => setWhoOwns(true)}
        />
        {visit ? (
          <ListRow
            title={visit.title}
            subtitle={visit.subtitle}
            icon="open-outline"
            accessibilityHint={`Opens ${visit.url} in your browser`}
            onPress={() => void openOutside(visit.url)}
            last
          />
        ) : null}
      </Group>

      <Button title="Sign out" variant="secondary" onPress={() => setConfirmOut(true)} style={{ marginTop: space.xl }} />
      <View style={{ alignItems: 'center', marginTop: space.xl, gap: 6 }}>
        <Wordmark size={18} />
        <Txt variant="caption" color="textMuted" align="center">
          {OWNERSHIP_SENTENCE}
        </Txt>
        {visit ? (
          <Pressable
            onPress={() => void openOutside(visit.url)}
            accessibilityRole="link"
            accessibilityLabel={visit.title}
            accessibilityHint={`Opens ${visit.url} in your browser`}
            hitSlop={8}
          >
            <Txt variant="caption" color="primary">
              {visit.title}
            </Txt>
          </Pressable>
        ) : null}
      </View>

      <BottomSheet
        visible={whoOwns}
        onClose={() => setWhoOwns(false)}
        title="Who owns holUpp?"
        subtitle={OWNERSHIP_SENTENCE}
      >
        <View style={{ gap: space.md }}>
          {OWNERSHIP_EXPLANATION.map((para) => (
            <Txt key={para.slice(0, 24)} variant="body" color="textSecondary">
              {para}
            </Txt>
          ))}
          {visit ? (
            <Button
              title={`Visit ${COMPANY_NAME} ↗`}
              icon="open-outline"
              onPress={() => {
                setWhoOwns(false);
                void openOutside(visit.url);
              }}
            />
          ) : null}
          <Button
            title="Email the company"
            variant="secondary"
            icon="mail-outline"
            onPress={() => void openOutside(`mailto:${COMPANY_CONTACT_EMAIL}`)}
          />
          <Button
            title="Email holUpp support"
            variant="ghost"
            icon="mail-outline"
            onPress={() => void openOutside(`mailto:${SUPPORT_EMAIL}`)}
          />
        </View>
      </BottomSheet>

      <ConfirmSheet
        visible={confirmOut}
        title="Sign out of holUpp?"
        message="Your Space stays exactly as it is. Sign back in anytime."
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
    onError: (e) => setError(errorLine(e)),
  });
  const status = useMutation({
    mutationFn: (s: 'active' | 'paused') => service.setStatus(s),
    onSuccess: (m) => {
      qc.setQueryData(keys.me, m);
      qc.invalidateQueries({ queryKey: keys.discover });
      setConfirmPause(false);
      toast({ kind: 'success', title: m.status === 'paused' ? 'Space hidden' : 'You’re visible again', message: m.status === 'paused' ? 'You won’t appear in Discover. Your Whispers stay open.' : undefined });
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
    onError: (e) => setError(errorLine(e)),
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
      <Group title="Visibility" footer="Hiding your Space takes you out of Discover. Your Connections and Whispers stay.">
        <ListRow
          title="Hide my Space"
          icon="moon-outline"
          toggle={{ value: paused, onChange: (v) => (v ? setConfirmPause(true) : status.mutate('active')) }}
          last
        />
      </Group>
      <Group title="Danger zone">
        <ListRow title="Delete account" subtitle="Permanently removes your Space, photos and Whispers" icon="trash-outline" destructive onPress={() => setSheet('delete')} last />
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
        subtitle="This can’t be undone. Your Space, photos, Moments, Crushes and Whispers will be permanently deleted."
        footer={<Button title="Delete permanently" variant="danger" loading={remove.isPending} disabled={!current} onPress={() => remove.mutate()} />}
      >
        <View style={{ gap: space.md }}>
          <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.goldSoft }}>
            <Txt variant="small">Just need a break? You can hide your Space instead and come back anytime.</Txt>
          </View>
          <Input label="Enter your password to confirm" value={current} onChangeText={setCurrent} secureTextEntry error={error} />
        </View>
      </BottomSheet>

      <ConfirmSheet
        visible={confirmPause}
        title="Hide your Space?"
        message="You won’t appear in Discover and people can’t Crush on you. Your existing conversations stay open."
        confirmLabel="Hide Space"
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
  const [soundsOn, setSoundsOn] = useState(soundEnabled());
  const [choice, setChoice] = useState(soundChoice());
  const [picking, setPicking] = useState(false);
  useEffect(() => whenSoundSettingLoaded(() => { setSoundsOn(soundEnabled()); setChoice(soundChoice()); }), []);
  // The phone decides this one, not the account: the row reports what Android
  // says and re-reads it whenever the member comes back from Android settings.
  const [barOk, setBarOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { void alertPermission().then((ok) => { if (live) setBarOk(ok); }); };
    read();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') read(); });
    return () => { live = false; sub.remove(); };
  }, []);
  const update = useUpdateNotificationSettings();
  const toast = useToast();
  if (!me) return <LoadingBlock />;
  const n = me.notifications;
  const set = (k: keyof typeof n) => (v: boolean) =>
    update.mutate({ [k]: v }, { onError: (e) => toast({ kind: 'error', title: 'Not saved', message: (e as Error).message }) });
  return (
    <Screen>
      <Header title="Notification settings" back />
      <Group footer="While holUpp is open a Whisper reaches you at once. While it is closed, holUpp checks about every 15 minutes — and once push delivery is switched on for this build, it arrives instantly instead. This screen will not claim faster than what is true.">
        {/* Sound is a device setting, not an account one: the phone in your pocket
            decides whether it rings, and it must be remembered on this phone even
            if the account is used elsewhere. */}
        <ListRow
          title="Sounds"
          subtitle="A soft chime when a Whisper or a notification arrives"
          icon="volume-medium-outline"
          iconTone="gold"
          toggle={{ value: soundsOn, onChange: (v) => { setSoundsOn(v); void setSoundEnabled(v); if (v) void playSound('message'); } }}
        />
        {/* Six chimes, chosen by ear. Tapping a row plays it *and* keeps it, which
            is the only way to pick a sound: reading the names tells you nothing. */}
        <ListRow
          title="Sound"
          subtitle={soundName(choice)}
          icon="musical-notes-outline"
          value={soundsOn ? soundName(choice) : 'Off'}
          onPress={() => setPicking(true)}
          last
        />
        {/* The banner is the other half of the same promise: a chime you cannot
            see is no better than a notification you cannot hear. */}
        <ListRow
          title="Show in the notification bar"
          subtitle={
            barOk === null ? 'Checking what this phone allows'
              : barOk ? 'Banners drop down, and unread ones wait in the shade'
                : 'Blocked for holUpp — tap to open Android settings'
          }
          icon="notifications-outline"
          iconTone={barOk ? 'gold' : 'neutral'}
          last
          onPress={async () => {
            const ok = await requestAlertPermission();
            setBarOk(ok);
            if (!ok) await Linking.openSettings().catch(() => {});
          }}
        />
      </Group>
      <ActionSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Notification sound"
        actions={SOUND_CHOICES.map((option) => ({
          label: option.name,
          hint: option.id === choice ? `${option.blurb} · selected` : option.blurb,
          icon: <Ionicons
            name={option.id === choice ? 'checkmark-circle' : 'play-circle-outline'}
            size={22}
            color={option.id === choice ? '#E8B54B' : '#9a938c'}
          />,
          onPress: () => {
            setChoice(option.id);
            void setSoundChoice(option.id);
            // Hear the one you just chose, immediately — even with Sounds off,
            // because asking to hear it is a different thing from being alerted.
            void playSound('message', { previewOf: option.id });
          },
        }))}
      />
      <Group footer="These choose what reaches the notification center, whichever way it arrives.">
        <ListRow title="Whispers" subtitle="New Whispers from your Connections" icon="chatbubble-outline" toggle={{ value: n.messages, onChange: set('messages') }} />
        <ListRow title="Add ups" subtitle="Add ups, Big Ups and people who added back" icon="heart-outline" toggle={{ value: n.crushes, onChange: set('crushes') }} />
        <ListRow title="Moments" subtitle="Replies and reactions to your Moments" icon="aperture-outline" toggle={{ value: n.moments, onChange: set('moments') }} />
        <ListRow title="Reposts" subtitle="When someone reposts one of your posts" icon="repeat-outline" toggle={{ value: n.reposts, onChange: set('reposts') }} />
        <ListRow title="Discoveries" subtitle="Occasional suggestions of people worth knowing" icon="compass-outline" toggle={{ value: n.recommendations, onChange: set('recommendations') }} last />
      </Group>
    </Screen>
  );
}

/* ----------------------------------------------------------- appearance */

export function AppearanceScreen() {
  const { appearance, setAppearance, colors } = useTheme();
  const options: { value: Appearance; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'dark', label: 'Dark', description: 'Black canvas, dark surfaces, light text.', icon: 'moon-outline' },
    { value: 'light', label: 'Light', description: 'White canvas, light surfaces, dark text.', icon: 'sunny-outline' },
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
  const openProfile = useProfileTap();
  const { data, isLoading } = useBlocks();
  const unblock = useUnblock();
  const toast = useToast();
  const [target, setTarget] = useState<{ id: number; name: string } | null>(null);
  return (
    <Screen>
      <Header title="People you’ve cut off" subtitle="They can’t see you, Crush on you or Whisper you." back />
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <EmptyState icon="ban-outline" title="You haven’t cut anyone off" message="If someone makes you uncomfortable, you can cut them off from their Space or your Whisper." />
      ) : (
        <Group>
          {data.map((b, i) => (
            <ListRow
              key={b.id}
              title={b.name}
              subtitle={`Cut off ${timeAgoLong(b.blockedAt)}`}
              trailing={<Button title="Let back in" size="sm" variant="secondary" onPress={() => setTarget(b)} />}
              leading={
                <Pressable
                  onPress={() => openProfile(b.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${b.name}’s Space`}
                >
                  <Avatar uri={b.photo} name={b.name} size={40} />
                </Pressable>
              }
              last={i === data.length - 1}
            />
          ))}
        </Group>
      )}
      <ConfirmSheet
        visible={!!target}
        title={`Let ${target?.name} back in?`}
        message="They may see you in Discover again. Your previous Crushes and conversation won’t come back."
        confirmLabel="Let back in"
        loading={unblock.isPending}
        onConfirm={() =>
          target &&
          unblock.mutate(target.id, {
            onSuccess: () => {
              toast({ kind: 'success', title: `${target.name} is back in` });
              setTarget(null);
            },
            onError: (e) => toast({ kind: 'error', title: 'Couldn’t let them back in', message: (e as Error).message }),
          })
        }
        onCancel={() => setTarget(null)}
      />
    </Screen>
  );
}
