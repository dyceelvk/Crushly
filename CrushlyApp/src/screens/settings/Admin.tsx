import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { ErrorState, LoadingBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import * as service from '../../api/service';
import type { ScreenProps } from '../../navigation/types';

export function AdminScreen(_props: ScreenProps<'Admin'>) {
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['admin-state'], queryFn: service.adminState, staleTime: 0 });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!data.data) return;
    setTitle(data.data.announcement.title); setBody(data.data.announcement.body); setActive(data.data.announcement.active);
  }, [data.data]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin-state'] }); void qc.invalidateQueries({ queryKey: ['app-settings'] }); };
  const feature = useMutation({ mutationFn: ({ key, enabled }: { key: 'calls' | 'public_post_sharing'; enabled: boolean }) => service.adminSetFeature(key, enabled), onSuccess: refresh, onError: (e) => toast({ kind: 'error', title: 'Not changed', message: (e as Error).message }) });
  const announcement = useMutation({ mutationFn: () => service.adminSetAnnouncement(title, body, active), onSuccess: () => { refresh(); toast({ kind: 'success', title: 'Announcement saved' }); }, onError: (e) => toast({ kind: 'error', title: 'Not saved', message: (e as Error).message }) });
  return <Screen><Header title="Holup admin" subtitle="Feature controls and announcements" back />
    {data.isLoading ? <LoadingBlock label="Loading admin controls" /> : data.isError || !data.data ? <ErrorState error={data.error} message="Admin controls are unavailable." onRetry={() => void data.refetch()} /> : <View style={{ gap: space.lg, paddingBottom: space.xl }}>
      <Txt variant="heading">Features</Txt>
      {([['calls', 'Voice calls', 'Controls call invitations and connection on the server.'], ['public_post_sharing', 'Public post links', 'Controls public post landing pages.']] as const).map(([key, label, hint]) => <View key={key} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <View style={{ flex: 1 }}><Txt variant="bodyStrong">{label}</Txt><Txt variant="small" color="textSecondary">{hint}</Txt></View>
        <Switch accessibilityLabel={label} value={!!data.data.features[key]} disabled={feature.isPending} onValueChange={(enabled) => feature.mutate({ key, enabled })} trackColor={{ false: colors.borderStrong, true: colors.primary }} />
      </View>)}
      <Txt variant="heading">Announcement</Txt>
      <Input label="Title" value={title} onChangeText={setTitle} maxLength={100} showCount />
      <Input label="Message" value={body} onChangeText={setBody} multiline maxLength={500} showCount />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Txt variant="bodyStrong">Show to members</Txt><Switch accessibilityLabel="Show announcement to members" value={active} onValueChange={setActive} trackColor={{ false: colors.borderStrong, true: colors.primary }} /></View>
      <Button title="Save announcement" onPress={() => announcement.mutate()} loading={announcement.isPending} disabled={active && (!title.trim() || !body.trim())} />
    </View>}
  </Screen>;
}
