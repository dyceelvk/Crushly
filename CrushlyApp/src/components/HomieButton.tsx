import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { homieStatus, requestHomie, respondHomie, withdrawHomie } from '../api/service';
import { useMe } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { useToast } from './Toast';
import { Txt } from './Txt';

/**
 * The Homie control, and the only relationship control that asks permission.
 *
 * It is one thing: a 🫂 button labelled "Homie". There is no "Add a Homie"
 * sentence beside it and no second verb — adding somebody up is a different
 * button elsewhere, and it never waits for an answer. Tapping this one sends a
 * request; the other person's tap is what makes it true.
 */
export function HomieButton({ id, name }: { id: number; name: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const state = useQuery({
    queryKey: ['holup-homie-status', me.data?.id, id],
    queryFn: () => homieStatus(id),
    enabled: !!me.data?.id && me.data.id !== id,
    staleTime: 15_000,
  });
  const mutate = useMutation({
    mutationFn: async (action: 'request' | 'withdraw' | 'accept' | 'decline') => {
      if (action === 'request') return requestHomie(id);
      if (action === 'withdraw') return withdrawHomie(id);
      return respondHomie(id, action === 'accept');
    },
    onSuccess: (_result, action) => {
      for (const key of ['holup-homie-status', 'holup-homie-requests', 'holup-homie-stats', 'space-relationship-people']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      if (!reduceMotion && (action === 'request' || action === 'accept')) {
        pulse.setValue(1);
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.22, duration: 150, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      }
      toast({
        kind: 'success',
        title:
          action === 'request' ? 'Homie request sent'
          : action === 'withdraw' ? 'Request withdrawn'
          : action === 'accept' ? `You and ${name} are Homies`
          : 'Request declined',
      });
    },
    onError: (e) => toast({ kind: 'error', title: 'Couldn’t update Homies', message: (e as Error).message }),
  });

  if (!me.data?.id || me.data.id === id) return null;
  if (state.isError) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Retry Homies with ${name}`} onPress={() => void state.refetch()}>
        <Txt variant="small" color="gold">Retry</Txt>
      </Pressable>
    );
  }

  const status = state.data;
  const busy = state.isLoading || mutate.isPending;

  // Homies: the icon settles, and the label is the relationship, not a verb.
  if (status?.homies) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={`You and ${name} are Homies`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
      >
        <Txt style={{ fontSize: 16 }}>🫂</Txt>
        <Txt variant="smallStrong" color="gold">Homies</Txt>
      </View>
    );
  }

  // They asked first: the answer belongs here, where the icon is.
  if (status?.incomingPending) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt style={{ fontSize: 16 }}>🫂</Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Accept ${name} as a Homie`}
          disabled={busy}
          onPress={() => mutate.mutate('accept')}
          style={{ opacity: busy ? 0.6 : 1 }}
        >
          <Txt variant="smallStrong" color="gold">Accept</Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decline ${name} as a Homie`}
          disabled={busy}
          onPress={() => mutate.mutate('decline')}
          style={{ opacity: busy ? 0.6 : 1 }}
        >
          <Txt variant="small" color="textSecondary">Decline</Txt>
        </Pressable>
      </View>
    );
  }

  const pending = !!status?.outgoingPending;

  // The button itself: 🫂 and the one word. Tapping again while it waits takes
  // the request back, which is why the label changes and nothing else does.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pending ? `Homie request to ${name} sent. Tap to withdraw` : `Ask ${name} to be Homies`}
      disabled={busy}
      onPress={() => mutate.mutate(pending ? 'withdraw' : 'request')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: pending ? colors.border : colors.gold,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.gold} />
      ) : (
        <Animated.Text style={{ fontSize: 16, transform: [{ scale: pulse }] }}>🫂</Animated.Text>
      )}
      <Txt variant="smallStrong" color={pending ? 'textSecondary' : 'gold'}>
        {pending ? 'Requested' : 'Homie'}
      </Txt>
    </Pressable>
  );
}
