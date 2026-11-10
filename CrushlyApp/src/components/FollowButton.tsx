import React from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { followMember, followStatus, unfollowMember } from '../api/service';
import { useMe } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { CrushIcon } from './Logo';
import { Txt } from './Txt';
import { useToast } from './Toast';

/** Real directional Add Up; a pending request is never presented as a follow. */
export function FollowButton({ id, name, compact = false }: {id: number; name: string; compact?: boolean}) {
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
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${name}`} disabled={stats.isLoading || change.isPending}
    onPress={() => stats.isError ? void stats.refetch() : change.mutate()}
    style={{flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5, paddingHorizontal:compact ? 9 : 16, paddingVertical:compact ? 7 : 10, borderRadius:10, backgroundColor: status ? colors.elevated : colors.primary, opacity: stats.isLoading || change.isPending ? 0.6 : 1}}>
    {stats.isLoading || change.isPending ? <ActivityIndicator size="small" color={status ? colors.text : '#fff'} /> : status ? <Ionicons name="checkmark" size={15} color={colors.text} /> : <CrushIcon size={15} color="#fff" />}
    <Txt variant="smallStrong" style={{color: status ? colors.text : '#fff'}}>{label}</Txt>
  </Pressable>;
}
