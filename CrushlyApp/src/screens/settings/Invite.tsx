import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Header, Screen, Spacer } from '../../components/Layout';
import { Button } from '../../components/Button';
import { Txt } from '../../components/Txt';
import { ErrorState, LoadingBlock } from '../../components/States';
import { useInviteInfo } from '../../api/hooks';
import { useToast } from '../../components/Toast';
import { copyInvitationLink, shareInvitationLink } from '../../lib/inviteShareActions';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

function Stat({ icon, value, label, tone }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string; tone: 'success' | 'gold' | 'neutral' }) {
  const { colors } = useTheme();
  const palette = tone === 'success'
    ? { bg: colors.successSoft, fg: colors.success }
    : tone === 'gold'
      ? { bg: colors.goldSoft, fg: colors.gold }
      : { bg: colors.elevated, fg: colors.textSecondary };
  return (
    <ViewStat>
      <ViewIcon background={palette.bg}>
        <Ionicons name={icon} size={17} color={palette.fg} />
      </ViewIcon>
      <Txt variant="display" style={{ marginTop: space.xs }}>{value}</Txt>
      <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>{label}</Txt>
    </ViewStat>
  );
}

function ViewStat({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: 0, backgroundColor: colors.card, padding: space.sm }}>
      {children}
    </Card>
  );
}

function ViewIcon({ children, background }: { children: React.ReactNode; background: string }) {
  return <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

/** Private, server-backed invitation link and qualification totals. */
export function InviteScreen(_props: ScreenProps<'Invite'>) {
  const { colors } = useTheme();
  const invite = useInviteInfo();
  const toast = useToast();
  const [busy, setBusy] = useState<'share' | 'copy' | null>(null);

  if (invite.isLoading) {
    return (
      <Screen>
        <Header title="Invite people" back />
        <LoadingBlock label="Loading your invitation link" />
      </Screen>
    );
  }

  if (invite.isError || !invite.data) {
    return (
      <Screen>
        <Header title="Invite people" back />
        <ErrorState error={invite.error} title="Your invite is unavailable" onRetry={() => { void invite.refetch(); }} />
      </Screen>
    );
  }

  const data = invite.data;
  const share = async () => {
    if (busy) return;
    setBusy('share');
    try {
      const result = await shareInvitationLink(data.code);
      if (result === 'shared') toast({ kind: 'success', title: 'Invitation ready to share', message: 'Your reusable HolUpp link is in the share sheet.' });
      else if (result === 'copied') toast({ kind: 'success', title: 'Link copied', message: 'Paste it anywhere you want to invite someone.' });
    } catch (error) {
      toast({ kind: 'error', title: 'Couldn’t share your link', message: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (busy) return;
    setBusy('copy');
    try {
      await copyInvitationLink(data.code);
      toast({ kind: 'success', title: 'Link copied', message: 'Your invitation link is ready to paste.' });
    } catch (error) {
      toast({ kind: 'error', title: 'Couldn’t copy your link', message: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Header title="Invite people" subtitle="Bring your people into HolUpp" back />

      <Card elevated style={{ borderColor: colors.primaryLine }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="link-outline" size={21} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="heading">Your invitation link</Txt>
            <Txt variant="small" color="textSecondary" style={{ marginTop: 3 }}>
              Reusable whenever you want to share HolUpp. Your totals are private to you.
            </Txt>
          </View>
        </View>
        <View accessible accessibilityLabel={`Invitation link ${data.link}`} style={{ marginTop: space.md, padding: space.sm, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}>
          <Txt variant="smallStrong" color="primary" numberOfLines={1} selectable>{data.link}</Txt>
        </View>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button title="Share invitation" icon="share-social-outline" onPress={() => { void share(); }} loading={busy === 'share'} disabled={!!busy && busy !== 'share'} />
          <Button title="Copy link" icon="copy-outline" variant="outline" onPress={() => { void copy(); }} loading={busy === 'copy'} disabled={!!busy && busy !== 'copy'} />
        </View>
      </Card>

      <Spacer h={space.xl} />
      <Txt variant="label" color="textSecondary" style={{ marginLeft: 4 }}>PRIVATE PROGRESS</Txt>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
        <Stat icon="checkmark-circle-outline" value={data.successful} label="Successful" tone="success" />
        <Stat icon="time-outline" value={data.pending} label="Getting started" tone="gold" />
        <Stat icon="people-outline" value={data.total} label="Attributed" tone="neutral" />
      </View>

      <Card style={{ marginTop: space.lg, backgroundColor: colors.elevated }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
          <Ionicons name="information-circle-outline" size={20} color={colors.gold} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Txt variant="bodyStrong">When does a referral count?</Txt>
            <Txt variant="small" color="textSecondary">
              Someone needs to confirm their account, finish onboarding and take a meaningful first step — posting, following someone or joining a Space. Opening the link or creating an account alone does not count.
            </Txt>
          </View>
        </View>
      </Card>
    </Screen>
  );
}
