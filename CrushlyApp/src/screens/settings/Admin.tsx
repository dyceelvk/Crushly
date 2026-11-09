import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { timeAgoLong } from '../../lib/format';
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
  const dirty = useRef(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [active, setActive] = useState(false);
  const [section, setSection] = useState<'controls' | 'reports' | 'accounts' | 'verification' | 'audit'>('controls');
  const [handled, setHandled] = useState(false);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const reports = useQuery({ queryKey: ['admin-reports', handled], queryFn: () => service.adminReports(handled), enabled: data.isSuccess && section === 'reports', staleTime: 30000 });
  const accounts = useQuery({ queryKey: ['admin-accounts', submittedSearch], queryFn: () => service.adminAccounts(submittedSearch), enabled: data.isSuccess && section === 'accounts' && submittedSearch.length >= 2, staleTime: 30000 });
  const verifications = useQuery({ queryKey: ['admin-verifications'], queryFn: service.adminVerifications, enabled: data.isSuccess && section === 'verification', staleTime: 30000 });
  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: service.adminAudit, enabled: data.isSuccess && section === 'audit', staleTime: 0 });
  const reportAction = useMutation({ mutationFn: ({ id, value }: { id: number; value: boolean }) => service.adminSetReportHandled(id, value),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-reports'] }); void qc.invalidateQueries({ queryKey: ['admin-audit'] }); toast({ kind: 'success', title: 'Report updated' }); },
    onError: (e) => toast({ kind: 'error', title: 'Report not changed', message: (e as Error).message }) });
  useEffect(() => {
    if (!data.data || dirty.current) return;
    setTitle(data.data.announcement.title); setBody(data.data.announcement.body); setActive(data.data.announcement.active);
  }, [data.data]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin-state'] }); void qc.invalidateQueries({ queryKey: ['app-settings'] }); };
  const feature = useMutation({ mutationFn: ({ key, enabled }: { key: 'calls' | 'public_post_sharing'; enabled: boolean }) => service.adminSetFeature(key, enabled), onSuccess: refresh, onError: (e) => toast({ kind: 'error', title: 'Not changed', message: (e as Error).message }) });
  const announcement = useMutation({ mutationFn: () => service.adminSetAnnouncement(title, body, active), onSuccess: () => { dirty.current = false; refresh(); toast({ kind: 'success', title: 'Announcement saved' }); }, onError: (e) => toast({ kind: 'error', title: 'Not saved', message: (e as Error).message }) });
  return <Screen><Header title="Holup admin" subtitle="Operations and controls" back />
    {data.isLoading ? <LoadingBlock label="Loading admin controls" /> : data.isError || !data.data ? <ErrorState error={data.error} message="Admin controls are unavailable." onRetry={() => void data.refetch()} /> : <View style={{ gap: space.lg, paddingBottom: space.xl }}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {([['controls', 'Controls'], ['reports', 'Reports'], ['accounts', 'Accounts'], ['verification', 'Verification'], ['audit', 'Audit']] as const).map(([value, label]) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: section === value }} onPress={() => setSection(value)}
            style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: section === value ? colors.primary : colors.border, backgroundColor: section === value ? colors.elevated : colors.card }}>
            <Txt variant="smallStrong">{label}</Txt>
          </Pressable>
        ))}
      </View>
      {section === 'controls' ? <View style={{ gap: space.lg }}>
      <Txt variant="heading">Features</Txt>
      {([['calls', 'Voice calls', 'Controls call invitations and connection on the server.'], ['public_post_sharing', 'Public post links', 'Controls public post landing pages.']] as const).map(([key, label, hint]) => <View key={key} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <View style={{ flex: 1 }}><Txt variant="bodyStrong">{label}</Txt><Txt variant="small" color="textSecondary">{hint}</Txt></View>
        <Switch accessibilityLabel={label} value={!!data.data.features[key]} disabled={feature.isPending} onValueChange={(enabled) => feature.mutate({ key, enabled })} trackColor={{ false: colors.borderStrong, true: colors.primary }} />
      </View>)}
      <Txt variant="heading">Announcement</Txt>
      <Input label="Title" value={title} onChangeText={(text) => { dirty.current = true; setTitle(text); }} maxLength={100} showCount />
      <Input label="Message" value={body} onChangeText={(text) => { dirty.current = true; setBody(text); }} multiline maxLength={500} showCount />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Txt variant="bodyStrong">Show to members</Txt><Switch accessibilityLabel="Show announcement to members" value={active} onValueChange={(value) => { dirty.current = true; setActive(value); }} trackColor={{ false: colors.borderStrong, true: colors.primary }} /></View>
      <Button title="Save announcement" onPress={() => announcement.mutate()} loading={announcement.isPending} disabled={active && (!title.trim() || !body.trim())} />
      </View> : null}
      {section === 'reports' ? <View style={{ gap: space.md }}>
        <Txt variant="heading">Reports</Txt>
        <Txt variant="small" color="textSecondary">Review reports privately. Marking a report reviewed does not suspend an account or remove content.</Txt>
        <Segmented value={handled ? 'reviewed' : 'open'} onChange={(value) => setHandled(value === 'reviewed')} options={[{ value: 'open', label: 'Open' }, { value: 'reviewed', label: 'Reviewed' }]} />
        {reports.isLoading ? <LoadingBlock label="Loading reports" /> : reports.isError ? <ErrorState error={reports.error} message="Reports are unavailable." onRetry={() => void reports.refetch()} /> : !(reports.data?.length) ? <Txt color="textSecondary">No reports in this list.</Txt> : reports.data.map((r) => <View key={r.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md, gap: space.xs }}>
          <Txt variant="bodyStrong">{r.reportedName || 'Member'} · #{r.reportedId}</Txt>
          <Txt variant="small">Reported by {r.reporterName || 'Member'} · {timeAgoLong(r.createdAt)}</Txt>
          <Txt variant="body">{r.reason.replace(/_/g, ' ')}{r.context ? ` · ${r.context}` : ''}</Txt>
          {r.details ? <Txt variant="small" color="textSecondary">{r.details}</Txt> : null}
          <Button title={handled ? 'Reopen report' : 'Mark reviewed'} size="sm" variant="secondary" disabled={reportAction.isPending} onPress={() => reportAction.mutate({ id: r.id, value: !handled })} />
        </View>)}
      </View> : null}
      {section === 'accounts' ? <View style={{ gap: space.md }}>
        <Txt variant="heading">Accounts</Txt>
        <Txt variant="small" color="textSecondary">Search by name, username or member ID. Account suspension controls are not available yet.</Txt>
        <Input label="Find an account" value={search} onChangeText={setSearch} maxLength={100} />
        <Button title="Search accounts" size="sm" disabled={search.trim().length < 2} onPress={() => setSubmittedSearch(search.trim())} />
        {accounts.isFetching ? <LoadingBlock label="Searching accounts" /> : accounts.isError ? <ErrorState error={accounts.error} message="Account search is unavailable." onRetry={() => void accounts.refetch()} /> : submittedSearch && !accounts.data?.length ? <Txt color="textSecondary">No matching accounts.</Txt> : accounts.data?.map((a) => <View key={a.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md }}>
          <Txt variant="bodyStrong">{a.name || 'Member'} · #{a.id}</Txt>
          <Txt variant="small" color="textSecondary">{a.username ? `@${a.username} · ` : ''}{a.status} · {a.onboarded ? 'onboarded' : 'not onboarded'} · {a.verification}</Txt>
        </View>)}
      </View> : null}
      {section === 'verification' ? <View style={{ gap: space.md }}>
        <Txt variant="heading">Verification</Txt>
        <Txt variant="small" color="textSecondary">Recent request statuses. Decisions and identity evidence remain with the verification provider; this screen cannot approve or reject them.</Txt>
        {verifications.isLoading ? <LoadingBlock label="Loading verification requests" /> : verifications.isError ? <ErrorState error={verifications.error} message="Verification requests are unavailable." onRetry={() => void verifications.refetch()} /> : !verifications.data?.length ? <Txt color="textSecondary">No verification requests.</Txt> : verifications.data.map((v) => <View key={v.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md }}>
          <Txt variant="bodyStrong">{v.memberName} · #{v.memberId}</Txt>
          <Txt variant="small" color="textSecondary">{v.status} · {timeAgoLong(v.createdAt)}</Txt>
        </View>)}
      </View> : null}
      {section === 'audit' ? <View style={{ gap: space.md }}>
        <Txt variant="heading">Admin activity</Txt>
        <Txt variant="small" color="textSecondary">Recent recorded admin actions and access to sensitive queues.</Txt>
        {audit.isLoading ? <LoadingBlock label="Loading admin activity" /> : audit.isError ? <ErrorState error={audit.error} message="Admin activity is unavailable." onRetry={() => void audit.refetch()} /> : !audit.data?.length ? <Txt color="textSecondary">No recorded activity.</Txt> : audit.data.map((event) => <View key={event.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md }}>
          <Txt variant="bodyStrong">{event.kind.replace(/_/g, ' ')}</Txt>
          <Txt variant="small" color="textSecondary">{timeAgoLong(event.createdAt)} · {event.actor}</Txt>
          <Txt variant="small">{JSON.stringify(event.details)}</Txt>
        </View>)}
      </View> : null}
    </View>}
  </Screen>;
}
