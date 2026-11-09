import React, { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { ConfirmSheet } from '../../components/BottomSheet';
import { ErrorState, LoadingBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { timeAgoLong } from '../../lib/format';
import * as service from '../../api/service';
import type { ScreenProps } from '../../navigation/types';

const kindLabel = (kind: service.ManualVerificationKind) => kind === 'creator' ? 'Creator verification' : 'Person ID verification';

export function VerificationThread({ caseId, onBack, admin = false }: { caseId: number; onBack: () => void; admin?: boolean }) {
  const { colors } = useTheme(); const toast = useToast(); const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const thread = useQuery({ queryKey: ['manual-verification-thread', caseId], queryFn: () => service.verificationThread(caseId), staleTime: 0, refetchInterval: 15000 });
  const decide = useMutation({ mutationFn: (value: 'approve' | 'reject') => service.verificationDecide(caseId, value, reason.trim()), onSuccess: () => { setDecision(null); setReason(''); void qc.invalidateQueries({ queryKey: ['manual-verification-thread', caseId] }); void qc.invalidateQueries({ queryKey: ['manual-verification-cases'] }); toast({ kind: 'success', title: 'Decision recorded' }); }, onError: (e) => { setDecision(null); toast({ kind: 'error', title: 'Decision not recorded', message: (e as Error).message }); } });
  const send = useMutation({ mutationFn: () => service.verificationSend(caseId, message.trim()), onSuccess: () => { setMessage(''); void qc.invalidateQueries({ queryKey: ['manual-verification-thread', caseId] }); }, onError: (e) => toast({ kind: 'error', title: 'Message not sent', message: (e as Error).message }) });
  return <Screen keyboard><Header title="Verification review" back onBack={onBack} />
    {thread.isLoading ? <LoadingBlock label="Loading review" /> : thread.isError || !thread.data ? <ErrorState error={thread.error} message="Review is unavailable." onRetry={() => void thread.refetch()} /> : <View style={{ gap: space.md }}>
      <Txt variant="bodyStrong">{kindLabel(thread.data.kind)} · {thread.data.status}</Txt>
      <Txt variant="small" color="textSecondary">This is a private review conversation. Do not send ID numbers or document images in text messages.</Txt>
      {thread.data.messages.length === 0 ? <Txt color="textSecondary">No messages yet. A reviewer may ask you questions here.</Txt> : thread.data.messages.map(m => <View key={m.id} style={{ padding: space.md, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <Txt variant="smallStrong">{m.role === 'admin' ? 'Holup reviewer' : 'Applicant'} · {timeAgoLong(m.createdAt)}</Txt><Txt variant="body">{m.body}</Txt>
      </View>)}
      {thread.data.status === 'open' ? <><Input label="Message" value={message} onChangeText={setMessage} multiline maxLength={2000} /><Button title="Send message" onPress={() => send.mutate()} disabled={!message.trim()} loading={send.isPending} /></> : null}
      {admin && thread.data.status === 'open' ? <View style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">Review decision</Txt>
        <Txt variant="small" color="textSecondary">{thread.data.kind === 'person_id' ? 'Person ID approval requires a successful Didit live capture linked to this case. That integration is not available yet.' : 'Gold is creator recognition; it does not assert ID verification.'}</Txt>
        <Input label="Decision reason" value={reason} onChangeText={setReason} multiline maxLength={500} />
        {thread.data.kind === 'creator' ? <Button title="Approve gold badge" onPress={() => setDecision('approve')} disabled={reason.trim().length < 10 || decide.isPending} /> : null}
        <Button title="Reject application" variant="danger" onPress={() => setDecision('reject')} disabled={reason.trim().length < 10 || decide.isPending} />
      </View> : null}
      <Button title="Refresh" variant="secondary" onPress={() => void thread.refetch()} />
    </View>}
    <ConfirmSheet visible={decision !== null} title={decision === 'approve' ? 'Award creator verification?' : 'Reject this application?'} message="The decision and reason will be sent to the applicant and recorded in the admin audit." confirmLabel={decision === 'approve' ? 'Approve' : 'Reject'} destructive={decision === 'reject'} loading={decide.isPending} onCancel={() => setDecision(null)} onConfirm={() => { if (decision) decide.mutate(decision); }} />
  </Screen>;
}

export function VerificationScreen({ navigation }: ScreenProps<'Verification'>) {
  const [kind, setKind] = useState<service.ManualVerificationKind | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const toast = useToast(); const qc = useQueryClient(); const { colors } = useTheme();
  const progress = useQuery({ queryKey: ['verification-progress', kind], queryFn: () => service.verificationProgress(kind!), enabled: !!kind, staleTime: 0 });
  const cases = useQuery({ queryKey: ['manual-verification-cases'], queryFn: () => service.verificationCases(), staleTime: 0 });
  const apply = useMutation({ mutationFn: () => service.verificationApply(kind!), onSuccess: (v) => { void qc.invalidateQueries({ queryKey: ['manual-verification-cases'] }); setCaseId(v.id); }, onError: (e) => toast({ kind: 'error', title: 'Couldn’t apply', message: (e as Error).message }) });
  if (caseId !== null) return <VerificationThread caseId={caseId} onBack={() => setCaseId(null)} />;
  return <Screen><Header title="Verification" back onBack={() => kind ? setKind(null) : navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { screen: 'Profile' })} />
    {!kind ? <View style={{ gap: space.md }}>
      <Txt color="textSecondary">Choose a verification. Meeting the requirements lets you apply; a Holup reviewer makes the final decision.</Txt>
      <Button title="Creator verification · Gold" onPress={() => setKind('creator')} />
      <Button title="Person ID verification · Diamond blue" variant="secondary" onPress={() => setKind('person_id')} />
      <Txt variant="heading">Your applications</Txt>
      {cases.isLoading ? <LoadingBlock label="Loading applications" /> : cases.isError ? <ErrorState error={cases.error} message="Applications are unavailable." onRetry={() => void cases.refetch()} /> : !cases.data?.length ? <Txt color="textSecondary">No applications yet.</Txt> : cases.data.map(item => <View key={item.id} style={{ padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: 14, gap: space.xs }}><Txt variant="bodyStrong">{kindLabel(item.kind)} · {item.status}</Txt><Button title="Open review" size="sm" variant="secondary" onPress={() => setCaseId(item.id)} /></View>)}
    </View> : <View style={{ gap: space.md }}>
      <Txt variant="heading">{kindLabel(kind)}</Txt>
      <Txt color="textSecondary">{kind === 'creator' ? 'Gold recognizes creators and their growth on Holup.' : 'Diamond blue recognizes a person’s identity after a reviewer’s decision and Didit live capture.'}</Txt>
      {progress.isLoading ? <LoadingBlock label="Checking your progress" /> : progress.isError || !progress.data ? <ErrorState error={progress.error} message="Requirements are unavailable." onRetry={() => void progress.refetch()} /> : <>
        <Txt variant="bodyStrong">Your progress</Txt>
        <Txt>Add Ups: {progress.data.addUps.toLocaleString()} / {kind === 'creator' ? '10,000' : '5,000'}</Txt>
        <Txt>Photo or video posts: {progress.data.mediaPosts.toLocaleString()} / 1,000</Txt>
        <Txt>Text posts: {progress.data.textPosts.toLocaleString()} / {kind === 'creator' ? '100' : '50'}</Txt>
        <Txt>{kind === 'creator' ? 'Crushes on posts' : 'Crushes on videos'}: {progress.data.crushes.toLocaleString()} / {kind === 'creator' ? '500,000' : '50,000'}</Txt>
        {kind === 'creator' ? <Txt>Posts in each of the last four 7-day periods: {progress.data.weeklyPosts.join(' / ')} (3 per period)</Txt> : null}
        {progress.data.adminExempt ? <Txt color="textSecondary">Admin accounts are exempt from the thresholds.</Txt> : null}
        <Txt variant="small" color="textSecondary">Counts use current posts and Crush reactions, not deleted posts or other reactions. Meeting the thresholds does not automatically award a badge.</Txt>
        <Button title="Apply for review" onPress={() => apply.mutate()} disabled={!progress.data.eligible} loading={apply.isPending} />
      </>}
      <Txt variant="bodyStrong">What a reviewer may ask for</Txt>
      <Txt color="textSecondary">{kind === 'creator' ? 'Your creator or public name, a short description of your work, and links to official channels or publications that show your work belongs to you. The reviewer may ask follow-up questions.' : 'Your full legal name and the name you use on Holup. If requested, you will complete a Didit live selfie and capture a valid government ID in the provider’s secure flow. A reviewer may ask follow-up questions.'}</Txt>
      <Txt variant="small" color="textSecondary">Never share passwords or sign-in codes. Do not send identity numbers, selfies or documents in chat. Secure evidence submission and the admin-directed capture flow are not yet available.</Txt>
    </View>}
  </Screen>;
}
