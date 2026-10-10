import React, { createContext, useCallback, useContext, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ActionSheet, BottomSheet, ConfirmSheet, type SheetAction } from '../components/BottomSheet';
import { Txt } from '../components/Txt';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/Toast';
import { useBlock, useRemoveConnection, useReport } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { REPORT_REASONS } from '../lib/catalog';

export type MemberRef = {
  id: number;
  name: string;
  age?: number | null;
  connected?: boolean;
  /** Where the report came from (profile, chat, moment…) — helps moderators. */
  context?: string;
  /** Called after the member is blocked / removed, e.g. to leave their screen. */
  onGone?: () => void;
};

type Ctx = {
  openActions: (m: MemberRef, extra?: SheetAction[]) => void;
  openReport: (m: MemberRef) => void;
  confirmBlock: (m: MemberRef) => void;
  confirmRemove: (m: MemberRef) => void;
};

const MemberActionsContext = createContext<Ctx | null>(null);

export function useMemberActions() {
  const ctx = useContext(MemberActionsContext);
  if (!ctx) throw new Error('useMemberActions must be used inside MemberActionsProvider');
  return ctx;
}

/**
 * One consistent safety surface used from profiles, chats, Discover and
 * Moments: share, report, block and remove connection are never more than two
 * taps away.
 */
export function MemberActionsProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [member, setMember] = useState<MemberRef | null>(null);
  const [extra, setExtra] = useState<SheetAction[]>([]);
  const [sheet, setSheet] = useState<'actions' | 'report' | 'block' | 'remove' | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const block = useBlock();
  const remove = useRemoveConnection();
  const report = useReport();

  const close = () => setSheet(null);

  const openActions = useCallback((m: MemberRef, more: SheetAction[] = []) => {
    setMember(m);
    setExtra(more);
    setSheet('actions');
  }, []);
  const openReport = useCallback((m: MemberRef) => {
    setMember(m);
    setReason(null);
    setDetails('');
    setAlsoBlock(true);
    setSheet('report');
  }, []);
  const confirmBlock = useCallback((m: MemberRef) => {
    setMember(m);
    setSheet('block');
  }, []);
  const confirmRemove = useCallback((m: MemberRef) => {
    setMember(m);
    setSheet('remove');
  }, []);

  const icon = (name: keyof typeof Ionicons.glyphMap, color = colors.textSecondary) => <Ionicons name={name} size={20} color={color} />;

  const actions: SheetAction[] = member
    ? [
        ...extra,
        {
          label: 'Share Space',
          icon: icon('share-outline'),
          hint: 'Only their first name and age are shared',
          onPress: () => {
            Share.share({ message: `Meet ${member.name}${member.age ? `, ${member.age}` : ''} on Crushly — a private space for men to connect.` }).catch(() => {});
          },
        },
        ...(member.connected
          ? [{ label: 'Remove connection', icon: icon('heart-dislike-outline'), hint: 'Ends your Mutual Crush and closes your Whisper', onPress: () => confirmRemove(member) }]
          : []),
        { label: `Flag ${member.name}`, icon: icon('flag-outline', colors.danger), destructive: true, hint: 'Confidential — they won’t know', onPress: () => openReport(member) },
        { label: `Cut Off ${member.name}`, icon: icon('ban-outline', colors.danger), destructive: true, hint: 'You’ll disappear from each other', onPress: () => confirmBlock(member) },
      ]
    : [];

  const submitReport = async () => {
    if (!member || !reason) return;
    try {
      await report.mutateAsync({ id: member.id, reason, details: details.trim(), context: member.context, alsoBlock });
      close();
      toast({
        kind: 'success',
        title: 'Thanks for telling us',
        message: `Our safety team reviews every flag.${alsoBlock ? ` ${member.name} is cut off.` : ''} He won’t know it was you.`,
      });
      if (alsoBlock) member.onGone?.();
    } catch (e) {
      toast({ kind: 'error', title: 'Flag not sent', message: (e as Error).message });
    }
  };

  return (
    <MemberActionsContext.Provider value={{ openActions, openReport, confirmBlock, confirmRemove }}>
      {children}
      <ActionSheet visible={sheet === 'actions'} onClose={close} title={member?.name} actions={actions} />

      <ConfirmSheet
        visible={sheet === 'block'}
        title={`Cut off ${member?.name}?`}
        message="You won’t see each other anywhere on Crushly, and your Whisper will close. He won’t be notified. You can let him back in later in Settings."
        confirmLabel="Cut Off"
        destructive
        loading={block.isPending}
        onCancel={close}
        onConfirm={async () => {
          if (!member) return;
          try {
            await block.mutateAsync(member.id);
            close();
            toast({ kind: 'success', title: `${member.name} is cut off`, message: 'You won’t see each other again.' });
            member.onGone?.();
          } catch (e) {
            toast({ kind: 'error', title: 'Couldn’t cut off', message: (e as Error).message });
          }
        }}
      />

      <ConfirmSheet
        visible={sheet === 'remove'}
        title="Remove this connection?"
        message={`This ends your Mutual Crush with ${member?.name} and closes your Whisper for both of you. This can’t be undone.`}
        confirmLabel="Remove connection"
        destructive
        loading={remove.isPending}
        onCancel={close}
        onConfirm={async () => {
          if (!member) return;
          try {
            await remove.mutateAsync(member.id);
            close();
            toast({ kind: 'success', title: 'Connection removed' });
            member.onGone?.();
          } catch (e) {
            toast({ kind: 'error', title: 'Couldn’t remove connection', message: (e as Error).message });
          }
        }}
      />

      <BottomSheet
        visible={sheet === 'report'}
        onClose={close}
        title={`Flag ${member?.name ?? ''}`}
        subtitle="Flags are confidential. Tell us what happened and our team will look into it."
        footer={<Button title="Send flag" onPress={submitReport} disabled={!reason} loading={report.isPending} variant="primary" />}
      >
        <View style={{ gap: 8 }} accessibilityRole="radiogroup">
          {REPORT_REASONS.map((r) => {
            const selected = reason === r.value;
            return (
              <Pressable
                key={r.value}
                onPress={() => setReason(r.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${r.label}. ${r.description}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1,
                  borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.goldSoft : colors.card,
                }}
              >
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.gold : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{r.label}</Txt>
                  <Txt variant="small" color="textSecondary">
                    {r.description}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Input
          label="Anything else? (optional)"
          placeholder="What happened? Details help us act quickly."
          value={details}
          onChangeText={setDetails}
          multiline
          maxLength={1000}
          containerStyle={{ marginTop: space.lg }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: space.lg }}>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">Cut off {member?.name} too</Txt>
            <Txt variant="small" color="textSecondary">
              Recommended. You’ll disappear from each other right away.
            </Txt>
          </View>
          <Toggle value={alsoBlock} onChange={setAlsoBlock} label={`Cut off ${member?.name} too`} />
        </View>
        <Txt variant="small" color="textMuted" style={{ marginTop: space.lg }}>
          If you’re in immediate danger, contact local emergency services or a trusted person first.
        </Txt>
      </BottomSheet>
    </MemberActionsContext.Provider>
  );
}
