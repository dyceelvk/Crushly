import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { homiePeople, homieRequests, respondHomie } from '../../api/service';
import { useMe } from '../../api/hooks';
import { Txt } from '../../components/Txt';
import { Avatar } from '../../components/Photo';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/States';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

/** Candidate only: accepted friendships and invitations, no remove action. */
export function CloseOnesPane({embedded=false}:{embedded?:boolean}) {
 const me=useMe(); const id=me.data?.id ?? 0; const nav=useNavigation<NativeStackNavigationProp<RootStackParamList>>();
 const {colors}=useTheme(); const insets=useSafeAreaInsets(); const {contentWidth,gutter}=useLayout(); const toast=useToast(); const qc=useQueryClient();
 const list=useInfiniteQuery({queryKey:['holup-homie-people',id],queryFn:({pageParam})=>homiePeople(id,pageParam),initialPageParam:0,enabled:!!id,getNextPageParam:(last,pages)=>last.hasMore?pages.reduce((n,p)=>n+p.items.length,0):undefined});
 const requests=useInfiniteQuery({queryKey:['holup-homie-requests',id],queryFn:({pageParam})=>homieRequests(pageParam),initialPageParam:0,enabled:!!id,getNextPageParam:(last,pages)=>last.hasMore?pages.reduce((n,p)=>n+p.items.length,0):undefined});
 const respond=useMutation({mutationFn:({person,accept}:{person:number;accept:boolean})=>respondHomie(person,accept),onSuccess:()=>{for(const key of ['holup-homie-people','holup-homie-requests','holup-homie-status','holup-homie-stats','space-relationship-people']) void qc.invalidateQueries({queryKey:[key]});},onError:e=>toast({kind:'error',title:'Couldn’t answer request',message:(e as Error).message})});
 const people=list.data?.pages.flatMap(p=>p.items) ?? []; const inbox=requests.data?.pages.flatMap(p=>p.items) ?? [];
 return <View style={{flex:1,backgroundColor:colors.bg}}><ScrollView contentContainerStyle={{paddingTop:embedded?0:insets.top+space.sm,paddingHorizontal:gutter,paddingBottom:space.xxxl,width:'100%',maxWidth:contentWidth,alignSelf:'center'}} refreshControl={<RefreshControl refreshing={list.isRefetching || requests.isRefetching} onRefresh={()=>{void list.refetch();void requests.refetch();}} tintColor={colors.gold} colors={[colors.gold]}/> }>
  {!embedded ? <View style={{flexDirection:'row',alignItems:'center',gap:8}}><IconButton icon="chevron-back" label="Go back" onPress={()=>nav.goBack()}/><Txt variant="display" accessibilityRole="header">Homies</Txt></View> : null}
  <Txt variant="small" color="textSecondary" style={{marginTop:space.md}}>Homies are accepted friendships. You can block someone for safety.</Txt>
  <Txt variant="subheading" style={{marginTop:space.lg}}>Requests</Txt>
  {requests.isLoading ? <LoadingBlock label="Loading Homie requests"/> : requests.isError ? <ErrorState error={requests.error} message="Couldn’t load Homie requests." onRetry={()=>void requests.refetch()}/> : requests.data?.pages.some(p=>p.unavailable) ? <Txt color="textSecondary" style={{marginTop:space.sm}}>Homie requests are not available yet.</Txt> : inbox.length ? <View style={{gap:space.sm,marginTop:space.sm}}>{inbox.map(p=><View key={p.id} style={{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:colors.card,borderRadius:radius.lg,padding:space.md}}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${p.name}’s Space`} onPress={()=>nav.navigate('UserProfile',{id:p.id})} style={{flex:1,flexDirection:'row',alignItems:'center',gap:8}}><Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={40}/><Txt variant="bodyStrong">{p.name}</Txt></Pressable><Button title="Accept" size="sm" disabled={respond.isPending} onPress={()=>respond.mutate({person:p.id,accept:true})}/><Button title="Decline" variant="ghost" size="sm" disabled={respond.isPending} onPress={()=>respond.mutate({person:p.id,accept:false})}/></View>)}{requests.hasNextPage ? <Button title="Show more requests" loading={requests.isFetchingNextPage} onPress={()=>void requests.fetchNextPage()}/> : null}</View> : <Txt color="textSecondary" style={{marginTop:space.sm}}>No requests right now.</Txt>}
  <Txt variant="subheading" style={{marginTop:space.xl}}>Your Homies</Txt>
  {list.isLoading ? <LoadingBlock label="Loading Homies"/> : list.isError ? <ErrorState error={list.error} message="Couldn’t load your Homies." onRetry={()=>void list.refetch()}/> : people.length ? <View style={{gap:space.sm,marginTop:space.sm}}>{people.map(p=><Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Open ${p.name}’s Space`} onPress={()=>nav.navigate('UserProfile',{id:p.id})} style={{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:colors.card,borderRadius:radius.lg,padding:space.md}}><Avatar uri={p.photos[0]?.url ?? null} name={p.name} size={46}/><View><Txt variant="bodyStrong">{p.name}</Txt>{p.username?<Txt variant="small" color="textSecondary">@{p.username}</Txt>:null}</View></Pressable>)}{list.hasNextPage ? <Button title="Show more Homies" loading={list.isFetchingNextPage} onPress={()=>void list.fetchNextPage()}/> : null}</View> : <EmptyState title="No Homies yet"/>}
 </ScrollView></View>;
}
