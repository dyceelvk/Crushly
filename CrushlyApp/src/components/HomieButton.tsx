import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { homieStatus, requestHomie, respondHomie, withdrawHomie } from '../api/service';
import { useMe } from '../api/hooks';
import { useTheme } from '../theme/ThemeProvider';
import { useToast } from './Toast';
import { CrushIcon } from './Logo';
import { Txt } from './Txt';

/** Candidate UI only: never release before its privacy/compatibility backend. */
export function HomieButton({id,name}:{id:number;name:string}) {
  const me=useMe(); const qc=useQueryClient(); const toast=useToast();
  const {colors,reduceMotion}=useTheme(); const pulse=useRef(new Animated.Value(1)).current;
  const state=useQuery({queryKey:['holup-homie-status',me.data?.id,id],queryFn:()=>homieStatus(id),enabled:!!me.data?.id && me.data.id!==id,staleTime:15_000});
  const mutate=useMutation({
    mutationFn: async (action:'request'|'withdraw'|'accept'|'decline') => {
      if (action==='request') return requestHomie(id);
      if (action==='withdraw') return withdrawHomie(id);
      return respondHomie(id,action==='accept');
    },
    onSuccess:(_result,action)=>{
      for (const key of ['holup-homie-status','holup-homie-requests','holup-homie-stats','space-relationship-people']) void qc.invalidateQueries({queryKey:[key]});
      if (!reduceMotion && (action==='request' || action==='accept')) {
        pulse.setValue(1); Animated.sequence([
          Animated.timing(pulse,{toValue:1.22,duration:150,useNativeDriver:true}),
          Animated.timing(pulse,{toValue:1,duration:200,useNativeDriver:true}),
        ]).start();
      }
      toast({kind:'success',title: action==='request' ? 'Homie request sent' : action==='withdraw' ? 'Request withdrawn' : action==='accept' ? `You and ${name} are Homies` : 'Request declined'});
    },
    onError:e=>toast({kind:'error',title:'Couldn’t update Homies',message:(e as Error).message}),
  });
  if (!me.data?.id || me.data.id===id) return null;
  if (state.isError) return <Pressable accessibilityRole="button" onPress={()=>void state.refetch()}><Txt variant="small" color="gold">Retry Homies</Txt></Pressable>;
  const status=state.data;
  if (status?.homies) return <View accessibilityLabel={`You and ${name} are Homies`} style={{flexDirection:'row',alignItems:'center',gap:5}}><CrushIcon size={15} color={colors.gold}/><Txt variant="smallStrong" color="gold">Homies</Txt></View>;
  if (status?.incomingPending) return <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Txt variant="small" color="textSecondary">Homie request</Txt><Pressable accessibilityRole="button" accessibilityLabel={`Accept ${name} as a Homie`} disabled={mutate.isPending} onPress={()=>mutate.mutate('accept')}><Txt variant="smallStrong" color="gold">Accept</Txt></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Decline ${name} as a Homie`} disabled={mutate.isPending} onPress={()=>mutate.mutate('decline')}><Txt variant="small" color="textSecondary">Decline</Txt></Pressable></View>;
  const pending=!!status?.outgoingPending;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${pending?'Withdraw Homie request to':'Add a Homie:'} ${name}`} disabled={state.isLoading || mutate.isPending} onPress={()=>mutate.mutate(pending?'withdraw':'request')} style={{flexDirection:'row',alignItems:'center',gap:6,paddingVertical:8}}>
    {state.isLoading || mutate.isPending ? <ActivityIndicator size="small" color={colors.gold}/> : <Animated.View style={{transform:[{scale:pulse}]}}><View style={{width:23,height:23,borderRadius:12,backgroundColor:colors.gold,alignItems:'center',justifyContent:'center'}}><CrushIcon size={13} color={colors.onGold}/>{!pending ? <Ionicons name="sparkles" size={8} color={colors.onGold} style={{position:'absolute',right:-2,top:-2}}/> : null}</View></Animated.View>}
    <Txt variant="smallStrong" color="gold">{pending?'Request sent · Withdraw':'Add a Homie'}</Txt>
  </Pressable>;
}
