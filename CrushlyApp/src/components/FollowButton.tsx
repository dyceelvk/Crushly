import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { followMember, followStatus, unfollowMember } from '../api/service';
import { useMe } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { CrushIcon } from './Logo';
import { Txt } from './Txt';
import { useToast } from './Toast';

/** Real directional Add Up; a pending request is never presented as a follow. */
export function FollowButton({ id, name, compact = false, full = false, variant = 'default' }: {id: number; name: string; compact?: boolean; full?: boolean; variant?: 'default' | 'hero'}) {
  const me = useMe();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const toast = useToast();
  const stats = useQuery({queryKey: ['holup-follow-status', me.data?.id, id], queryFn: () => followStatus(id), enabled: !!me.data?.id && me.data.id !== id, staleTime: 20_000});
  const status = stats.data?.status ?? null;
  const change = useMutation({
    mutationFn: async () => status ? (await unfollowMember(id), null) : await followMember(id),
    onSuccess: (result) => {
      void qc.invalidateQueries({queryKey: ['holup-follow-status']});
      void qc.invalidateQueries({queryKey: ['space-relationship-stats']});
      void qc.invalidateQueries({queryKey: ['space-relationship-people']});
      toast({kind: 'success', title: result?.status === 'pending' ? 'Add Up request sent' : result?.status === 'active' ? `Added up ${name}` : 'Add Up removed'});
    },
    onError: (error) => toast({kind: 'error', title: 'Couldn’t update Add Up', message: (error as Error).message}),
  });
  if (!me.data?.id || me.data.id === id) return null;
  // Already Homies: the deployed backend refuses another Add Up here, and the
  // Space carries the connection controls. Nothing to offer, so offer nothing.
  if (stats.data?.connected) return null;
  const label = stats.isError ? 'Retry Add Up' : status === 'active' ? 'Added Up' : status === 'pending' ? 'Request sent' : 'Add Up';
  const busy = stats.isLoading || change.isPending;
  const inner = (
    <>
      {busy ? <ActivityIndicator size="small" color={status ? colors.text : '#fff'} /> : status ? <Ionicons name="checkmark" size={15} color={colors.text} /> : <CrushIcon size={15} color="#fff" />}
        <Txt variant={variant === 'hero' ? 'bodyStrong' : 'smallStrong'} style={{ color: status ? colors.text : '#fff', fontSize: variant === 'hero' ? 14 : undefined }}>{label}</Txt>
    </>
  );
  /* `hero` is the profile mock-up's main act: a wide gradient pill that owns
     the row. Pressed states keep their plain shapes — once an Add Up exists the
     button is a fact, not an invitation, and the gradient stands down. */
  if (variant === 'hero') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${name}`}
        disabled={busy}
        onPress={() => stats.isError ? void stats.refetch() : change.mutate()}
        style={{ flex: 1, borderRadius: 13, overflow: 'hidden', opacity: busy ? 0.6 : 1 }}
      >
        {status ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 13, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.borderStrong }}>
            {inner}
          </View>
        ) : (
          <LinearGradient
            colors={[colors.primary, colors.crushDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 13 }}
          >
            {inner}
          </LinearGradient>
        )}
      </Pressable>
    );
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${name}`} disabled={stats.isLoading || change.isPending}
    onPress={() => stats.isError ? void stats.refetch() : change.mutate()}
    /* `full` is the Space header's main action: a pill that fills the row
       beside the circular controls, at the same height as the owner's Edit
       Space. Without it the button keeps its natural width, which is right in
       a list row and wrong as the one thing a visitor came to press. */
    style={{flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5, paddingHorizontal:compact ? 9 : 16, paddingVertical:full ? 13 : compact ? 7 : 10, borderRadius:full ? 999 : 10, backgroundColor: status ? colors.elevated : colors.primary, opacity: busy ? 0.6 : 1}}>
    {busy ? <ActivityIndicator size="small" color={status ? colors.text : '#fff'} /> : status ? <Ionicons name="checkmark" size={15} color={colors.text} /> : <CrushIcon size={15} color="#fff" />}
    <Txt variant="smallStrong" style={{color: status ? colors.text : '#fff'}}>{label}</Txt>
  </Pressable>;
}
