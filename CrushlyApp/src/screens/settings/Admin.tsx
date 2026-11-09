import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, View, useWindowDimensions } from 'react-native';
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
import { useAuth } from '../../state/auth';

export function AdminScreen(_props: ScreenProps<'Admin'>) {
  const { colors } = useTheme();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const qc = useQueryClient();
  const { me } = useAuth();
  const adminId = me?.id ?? null;
  const data = useQuery({ queryKey: ['admin-state', adminId], queryFn: service.adminState, enabled: adminId !== null, staleTime: 0 });
  const dirty = useRef(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [active, setActive] = useState(false);
  const [section, setSection] = useState<'dashboard' | 'controls' | 'reports' | 'accounts' | 'audit'>('dashboard');
  const [handled, setHandled] = useState(false);
  const [reportPage, setReportPage] = useState(0);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const analytics = useQuery({ queryKey: ['admin-analytics', adminId], queryFn: service.adminAnalytics, enabled: data.isSuccess && section === 'dashboard', staleTime: 30000 });
  const reports = useQuery({ queryKey: ['admin-reports', adminId, handled, reportPage], queryFn: () => service.adminReports(handled, reportPage * 50), enabled: data.isSuccess && section === 'reports', staleTime: 30000 });
  const accounts = useQuery({ queryKey: ['admin-accounts', adminId, submittedSearch], queryFn: () => service.adminAccounts(submittedSearch), enabled: data.isSuccess && section === 'accounts' && (submittedSearch.length >= 2 || /^[0-9]+$/.test(submittedSearch)), staleTime: 30000 });
  const audit = useQuery({ queryKey: ['admin-audit', adminId], queryFn: service.adminAudit, enabled: data.isSuccess && section === 'audit', staleTime: 0 });
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
    {data.isLoading ? <LoadingBlock label="Loading admin controls" /> : data.isError || !data.data ? <ErrorState error={data.error} message="Admin controls are unavailable." onRetry={() => void data.refetch()} /> : <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg, paddingBottom: space.xl }}>
      <View accessibilityRole="tablist" style={{ width: wide ? 180 : undefined, flexDirection: wide ? 'column' : 'row', flexWrap: 'wrap', gap: space.xs }}>
        {([['dashboard', 'Dashboard'], ['controls', 'Action board'], ['reports', 'Reports'], ['accounts', 'Accounts'], ['audit', 'Admin activity']] as const).map(([value, label]) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: section === value }} onPress={() => setSection(value)}
            style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: section === value ? colors.primary : colors.border, backgroundColor: section === value ? colors.elevated : colors.card }}>
            <Txt variant="smallStrong">{label}</Txt>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space.lg }}>
      {section === 'dashboard' ? <View style={{ gap: space.md }}>
        <Txt variant="heading">Dashboard</Txt>
        <Txt variant="small" color="textSecondary">Live totals from Holup. Activity is the last 7 days; message contents are not shown.</Txt>
        {analytics.isLoading ? <LoadingBlock label="Loading analytics" /> : analytics.isError || !analytics.data ? <ErrorState error={analytics.error} message="Analytics are unavailable." onRetry={() => void analytics.refetch()} /> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {([
            ['Members', analytics.data.members], ['Seen in last 7 days', analytics.data.seenLast7Days],
            ['New members · 7 days', analytics.data.newMembersLast7Days], ['Posts · 7 days', analytics.data.postsLast7Days],
            ['Post reactions · 7 days', analytics.data.reactionsLast7Days], ['Comments · 7 days', analytics.data.commentsLast7Days],
            ['Whispers sent · 7 days', analytics.data.whispersLast7Days], ['Open reports', analytics.data.openReports],
          ] as const).map(([label, count]) => <View key={label} style={{ width: wide ? '30%' : '47%', flexGrow: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 14, padding: space.md }}><Txt variant="heading">{count.toLocaleString()}</Txt><Txt variant="small" color="textSecondary">{label}</Txt></View>)}
        </View>}
      </View> : null}
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
        <Segmented value={handled ? 'reviewed' : 'open'} onChange={(value) => { setHandled(value === 'reviewed'); setReportPage(0); }} options={[{ value: 'open', label: 'Open' }, { value: 'reviewed', label: 'Reviewed' }]} />
        {reports.isLoading ? <LoadingBlock label="Loading reports" /> : reports.isError ? <ErrorState error={reports.error} message="Reports are unavailable." onRetry={() => void reports.refetch()} /> : !(reports.data?.length) ? <Txt color="textSecondary">No reports in this list.</Txt> : reports.data.slice(0, 50).map((r) => <View key={r.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md, gap: space.xs }}>
          <Txt variant="bodyStrong">{r.reportedName || 'Member'} · #{r.reportedId}</Txt>
          <Txt variant="small">Reported by {r.reporterName || 'Member'} · {timeAgoLong(r.createdAt)}</Txt>
          <Txt variant="body">{r.reason.replace(/_/g, ' ')}{r.context ? ` · ${r.context}` : ''}</Txt>
          {r.details ? <Txt variant="small" color="textSecondary">{r.details}</Txt> : null}
          <Button title={handled ? 'Reopen report' : 'Mark reviewed'} size="sm" variant="secondary" disabled={reportAction.isPending} onPress={() => reportAction.mutate({ id: r.id, value: !handled })} />
        </View>)}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {reportPage > 0 ? <Button title="Previous" size="sm" variant="secondary" full={false} onPress={() => { setReportPage(reportPage - 1); }} /> : null}
          {(reports.data?.length ?? 0) > 50 ? <Button title="Next" size="sm" variant="secondary" full={false} onPress={() => { setReportPage(reportPage + 1); }} /> : null}
        </View>
      </View> : null}
      {section === 'accounts' ? <View style={{ gap: space.md }}>
        <Txt variant="heading">Accounts</Txt>
        <Txt variant="small" color="textSecondary">Search by name, username or member ID. Up to 30 matches are shown. Account suspension controls are not available yet.</Txt>
        <Input label="Find an account" value={search} onChangeText={setSearch} maxLength={100} />
        <Button title="Search accounts" size="sm" disabled={search.trim().length < 2 && !/^[0-9]+$/.test(search.trim())} onPress={() => setSubmittedSearch(search.trim())} />
        {accounts.isFetching ? <LoadingBlock label="Searching accounts" /> : accounts.isError ? <ErrorState error={accounts.error} message="Account search is unavailable." onRetry={() => void accounts.refetch()} /> : submittedSearch && !accounts.data?.length ? <Txt color="textSecondary">No matching accounts.</Txt> : accounts.data?.map((a) => <View key={a.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md }}>
          <Txt variant="bodyStrong">{a.name || 'Member'} · #{a.id}</Txt>
          <Txt variant="small" color="textSecondary">{a.username ? `@${a.username} · ` : ''}{a.status} · {a.onboarded ? 'onboarded' : 'not onboarded'} · {a.verification}</Txt>
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
      </View>
    </View>}
  </Screen>;
}
