import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Wordmark, CrushlyMark } from '../../components/Logo';
import { Glow } from '../../components/Ambient';
import { useToast } from '../../components/Toast';
import { useMe } from '../../api/hooks';
import { recordPlusInterest } from '../../api/service';
import { keys } from '../../api/hooks';
import type { Me } from '../../api/types';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

const PLUS = [
  { icon: 'sparkles-outline' as const, title: 'More Big Crushes', body: 'More every day, for when someone really stands out.' },
  { icon: 'eye-off-outline' as const, title: 'Incognito', body: 'Only people you Crush on can see you in Discover.' },
  { icon: 'airplane-outline' as const, title: 'Travel mode', body: 'Discover a city before you land.' },
  { icon: 'arrow-undo-outline' as const, title: 'Second look', body: 'Bring back someone you passed on by accident.' },
];

const FREE = ['Unlimited Crushes', 'See who’s crushing on you', 'Unlimited Whispers', 'Moments', 'Verification', 'Every safety tool'];

export function PlusScreen({ navigation, route }: ScreenProps<'Plus'>) {
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const join = useMutation({
    mutationFn: () => recordPlusInterest(),
    onSuccess: (next) => {
      qc.setQueryData(keys.me, next);
      toast({ kind: 'success', title: 'You’re on the list', message: 'We’ll let you know when Crushly Plus opens.' });
    },
    onError: (e) => toast({ kind: 'error', title: 'Something went wrong', message: (e as Error).message }),
  });

  return (
    <Screen
      footer={
        me?.plus.interested ? (
          <Button title="You’re on the early access list" icon="checkmark-circle" variant="secondary" disabled />
        ) : (
          <Button title="Join early access" onPress={() => join.mutate()} loading={join.isPending} />
        )
      }
    >
      <Header title="" back />
      <View style={{ alignItems: 'center', overflow: 'visible' }}>
        <Glow size={320} color={colors.gold} opacity={0.35} style={{ position: 'absolute', top: -120 }} />
        <CrushlyMark size={64} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md }}>
          <Wordmark size={30} />
          <Txt variant="display" color="gold">
            Plus
          </Txt>
        </View>
        <Txt variant="body" color="textSecondary" align="center" style={{ marginTop: space.sm, maxWidth: 340 }}>
          A few extra touches for members who want them. Coming soon.
        </Txt>
        {route.params?.feature ? (
          <View style={{ marginTop: space.md, backgroundColor: colors.goldSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Txt variant="smallStrong" color="gold">
              {route.params.feature} is part of Plus
            </Txt>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: space.xl, gap: space.md }}>
        {PLUS.map((f) => (
          <View key={f.title} style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name={f.icon} size={22} color={colors.gold} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{f.title}</Txt>
              <Txt variant="small" color="textSecondary" style={{ marginTop: 2 }}>
                {f.body}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      <View style={{ marginTop: space.xl }}>
        <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm }}>
          Always free on Crushly
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {FREE.map((f) => (
            <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: '47%' }}>
              <Ionicons name="checkmark" size={16} color={colors.success} />
              <Txt variant="small">{f}</Txt>
            </View>
          ))}
        </View>
        <Txt variant="caption" color="textMuted" style={{ marginTop: space.lg }}>
          Payments aren’t live yet. Joining early access is free, and you won’t be charged.
        </Txt>
      </View>
    </Screen>
  );
}
