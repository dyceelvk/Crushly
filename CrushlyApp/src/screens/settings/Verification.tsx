import React, { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Photo';
import { VerifiedBadge } from '../../components/Badges';
import { useToast } from '../../components/Toast';
import { keys, useMe } from '../../api/hooks';
import { getDiditStatus, type DiditStatusResponse } from '../../api/service';
import { space } from '../../theme/tokens';
import { isVerificationReturn } from '../../lib/verification';
import type { ScreenProps } from '../../navigation/types';

/** The old self-service path is paused until admin-requested review is ready. */
export function VerificationScreen({ navigation }: ScreenProps<'Verification'>) {
  const { data: me } = useMe();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<DiditStatusResponse | null>(null);
  const verified = (result?.status ?? me?.verification.status ?? 'none') === 'verified';
  const hasRequest = !!result?.sessionId || result?.status === 'pending' || me?.verification.status === 'pending';
  const width = Math.min(contentWidth - gutter * 2, 340);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setResult(await getDiditStatus());
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t check the status', message: (e as Error).message });
    } finally { setChecking(false); }
  }, [qc, toast]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && isVerificationReturn(window.location.search)) {
      const params = new URLSearchParams(window.location.search);
      params.delete('didit'); params.delete('status');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
    }
    void refresh();
  }, [refresh]);

  return (
    <Screen footer={hasRequest && !verified ? <Button title="Check status" variant="secondary" icon="refresh" onPress={refresh} loading={checking} /> : undefined}>
      <Header title="Verification" back onBack={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Profile' })} />
      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <View>
          <Avatar uri={me?.profile.photos[0]?.url} name={me?.profile.name} size={104} ring={verified ? 'gold' : undefined} />
          {verified ? <View style={{ position: 'absolute', right: 0, bottom: 4 }}><VerifiedBadge size={30} /></View> : null}
        </View>
      </View>
      <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
        <Txt variant="heading" align="center">{verified ? 'You’re verified' : 'Verification is being updated'}</Txt>
        <Txt variant="body" color="textSecondary" align="center" style={{ maxWidth: width }}>
          {verified ? 'Your existing badge remains on your Space.' : hasRequest
            ? 'Your existing verification request is preserved. Provider checks alone do not assign a badge; an admin review is required. New sessions are temporarily paused.'
            : 'New verification requests are temporarily paused while we prepare admin review. Please check back later.'}
        </Txt>
      </View>
    </Screen>
  );
}
