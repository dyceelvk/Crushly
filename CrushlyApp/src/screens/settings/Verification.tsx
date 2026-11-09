import React, { useState } from 'react';
import { Image, Linking, Platform, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
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
  const [image, setImage] = useState<{ id: string; uri: string } | null>(null);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const thread = useQuery({ queryKey: ['manual-verification-thread', caseId], queryFn: () => service.verificationThread(caseId), staleTime: 0, refetchInterval: 15000 });
  const decide = useMutation({ mutationFn: (value: 'approve' | 'reject') => service.verificationDecide(caseId, value, reason.trim()), onSuccess: () => { setDecision(null); setReason(''); void qc.invalidateQueries({ queryKey: ['manual-verification-thread', caseId] }); void qc.invalidateQueries({ queryKey: ['manual-verification-cases'] }); toast({ kind: 'success', title: 'Decision recorded' }); }, onError: (e) => { setDecision(null); toast({ kind: 'error', title: 'Decision not recorded', message: (e as Error).message }); } });
  const capture = useQuery({ queryKey: ['manual-capture-state', caseId], queryFn: () => service.verificationCaptureState(caseId), enabled: thread.data?.kind === 'person_id' && thread.data.status === 'open', staleTime: 0 });
  const requestCapture = useMutation({ mutationFn: () => service.verificationRequestCapture(caseId), onSuccess: () => { void capture.refetch(); void thread.refetch(); toast({ kind: 'success', title: 'Capture requested' }); }, onError: e => toast({ kind: 'error', title: 'Could not request capture', message: (e as Error).message }) });
  const captureAction = useMutation({ mutationFn: (action: 'start' | 'refresh') => service.verificationCaptureAction(caseId, action), onSuccess: async (result, action) => { await capture.refetch(); if (action === 'start' && result.url) { try { const u = new URL(result.url); if (u.protocol !== 'https:' || u.hostname !== 'verify.didit.me') throw new Error('Unexpected capture address.'); if (u.username || u.password) throw new Error('Unexpected capture address.'); if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(u.href); else await Linking.openURL(u.href); } catch { toast({ kind: 'error', title: 'Could not open secure capture', message: 'Please try again.' }); } } else if (action === 'refresh') { toast({ kind: 'info', title: 'Capture status updated' }); } }, onError: e => toast({ kind: 'error', title: 'Capture unavailable', message: (e as Error).message }) });
  const files = useQuery({ queryKey: ['manual-verification-files', caseId], queryFn: () => service.verificationFiles(caseId), enabled: !!thread.data, staleTime: 0 });
  const upload = useMutation({ mutationFn: async () => {
    const chosen = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.8, allowsEditing: false });
    if (chosen.canceled) return false;
    const asset = chosen.assets[0];
    if (!asset?.base64) throw new Error('Could not read this image. Choose a JPEG, PNG or WebP image.');
    if (asset.base64.length > 6990512) throw new Error('Choose an image under 5 MB.');
    await service.verificationUploadImage(caseId, asset.base64); return true;
  }, onSuccess: ok => { if (ok) { void files.refetch(); toast({ kind: 'success', title: 'Image added' }); } }, onError: e => toast({ kind: 'error', title: 'Image not added', message: (e as Error).message }) });
  const readImage = useMutation({ mutationFn: async (id: string) => { const result = await service.verificationReadImage(id); return { id, uri: `data:${result.mime};base64,${result.base64}` }; }, onSuccess: setImage, onError: e => toast({ kind: 'error', title: 'Image unavailable', message: (e as Error).message }) });
  const deleteImage = useMutation({ mutationFn: (id: string) => service.verificationDeleteImage(id), onSuccess: (result, id) => { if (image?.id === id) setImage(null); void files.refetch(); toast({ kind: result.deleted ? 'success' : 'info', title: result.deleted ? 'Image removed' : 'Image hidden; deletion will be retried' }); }, onError: e => toast({ kind: 'error', title: 'Image not removed', message: (e as Error).message }) });
  const send = useMutation({ mutationFn: () => service.verificationSend(caseId, message.trim()), onSuccess: () => { setMessage(''); void qc.invalidateQueries({ queryKey: ['manual-verification-thread', caseId] }); }, onError: (e) => toast({ kind: 'error', title: 'Message not sent', message: (e as Error).message }) });
  return <Screen keyboard><Header title="Verification review" back onBack={onBack} />
    {thread.isLoading ? <LoadingBlock label="Loading review" /> : thread.isError || !thread.data ? <ErrorState error={thread.error} message="Review is unavailable." onRetry={() => void thread.refetch()} /> : <View style={{ gap: space.md }}>
      <Txt variant="bodyStrong">{kindLabel(thread.data.kind)} · {thread.data.status}</Txt>
      <Txt variant="small" color="textSecondary">This is a private review conversation. Do not send ID numbers or document images in text messages.</Txt>
      {thread.data.messages.length === 0 ? <Txt color="textSecondary">No messages yet. A reviewer may ask you questions here.</Txt> : thread.data.messages.map(m => <View key={m.id} style={{ padding: space.md, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <Txt variant="smallStrong">{m.role === 'admin' ? 'Holup reviewer' : 'Applicant'} · {timeAgoLong(m.createdAt)}</Txt><Txt variant="body">{m.body}</Txt>
      </View>)}
      {thread.data.status === 'open' ? <><Input label="Message" value={message} onChangeText={setMessage} multiline maxLength={2000} /><Button title="Send message" onPress={() => send.mutate()} disabled={!message.trim()} loading={send.isPending} /></> : null}
      <View style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">Review images</Txt>
        <Txt variant="small" color="textSecondary">Share only what the reviewer asks for. Images are intended for this application and authorized reviewers; never upload passwords or sign-in codes. JPEG, PNG or WebP up to 5 MB; maximum six images.</Txt>
        {files.isLoading ? <LoadingBlock label="Loading images" /> : files.isError ? <ErrorState error={files.error} message="Images are unavailable." onRetry={() => void files.refetch()} /> : !files.data?.length ? <Txt variant="small" color="textSecondary">No images added.</Txt> : files.data.map((file, i) => <Button key={file.id} title={`Open review image ${i + 1}`} size="sm" variant="secondary" loading={readImage.isPending && readImage.variables === file.id} onPress={() => readImage.mutate(file.id)} />)}
        {image ? <><Image source={{ uri: image.uri }} resizeMode="contain" style={{ width: '100%', height: 360 }} /><Button title="Close image" size="sm" variant="secondary" onPress={() => setImage(null)} />{!admin ? <Button title="Remove this image" size="sm" variant="danger" loading={deleteImage.isPending} onPress={() => deleteImage.mutate(image.id)} /> : null}</> : null}
        {!admin && thread.data.status === 'open' && (files.data?.length ?? 0) < 6 ? <Button title="Add requested image" variant="secondary" loading={upload.isPending} onPress={() => upload.mutate()} /> : null}
      </View>
      {thread.data.kind === 'person_id' && thread.data.status === 'open' ? <View style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">Secure ID capture</Txt>
        {capture.isLoading ? <LoadingBlock label="Loading capture status" /> : capture.isError ? <ErrorState error={capture.error} message="Capture status is unavailable." onRetry={() => void capture.refetch()} /> : <>
          <Txt variant="small" color="textSecondary">{({ not_requested: 'Waiting for a reviewer to request capture.', requested: 'The reviewer has requested live capture.', creating: 'Capture is being prepared.', created: 'Capture is ready or in progress.', approved: 'Capture completed. Your application still needs a reviewer’s decision.', declined: 'Capture did not pass. Ask your reviewer about trying again.', review: 'Capture is under provider review.', expired: 'Capture expired. Ask your reviewer for another request.' } as Record<service.VerificationCaptureState, string>)[capture.data ?? 'not_requested']}</Txt>
          {admin && ['not_requested', 'declined', 'expired'].includes(capture.data ?? '') ? <Button title="Request Didit live capture" variant="secondary" loading={requestCapture.isPending} onPress={() => requestCapture.mutate()} /> : null}
          {!admin && ['requested', 'created'].includes(capture.data ?? '') ? <Button title="Open secure live capture" loading={captureAction.isPending} onPress={() => captureAction.mutate('start')} /> : null}
          {['created', 'review', 'approved'].includes(capture.data ?? '') ? <Button title="Check capture status" variant="secondary" loading={captureAction.isPending} onPress={() => captureAction.mutate('refresh')} /> : null}
        </>}
      </View> : null}
      {admin && thread.data.status === 'open' ? <View style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">Review decision</Txt>
        <Txt variant="small" color="textSecondary">{thread.data.kind === 'person_id' ? 'Person ID approval requires a successful Didit live capture linked to this application.' : 'Gold is creator recognition; it does not assert ID verification.'}</Txt>
        <Input label="Decision reason" value={reason} onChangeText={setReason} multiline maxLength={500} />
        {thread.data.kind === 'creator' || capture.data === 'approved' ? <Button title={thread.data.kind === 'creator' ? 'Approve gold badge' : 'Approve diamond blue badge'} onPress={() => setDecision('approve')} disabled={reason.trim().length < 10 || decide.isPending} /> : null}
        <Button title="Reject application" variant="danger" onPress={() => setDecision('reject')} disabled={reason.trim().length < 10 || decide.isPending} />
      </View> : null}
      <Button title="Refresh" variant="secondary" onPress={() => void thread.refetch()} />
    </View>}
    <ConfirmSheet visible={decision !== null} title={decision === 'approve' ? 'Award this verification badge?' : 'Reject this application?'} message="The decision and reason will be sent to the applicant and recorded in the admin audit." confirmLabel={decision === 'approve' ? 'Approve' : 'Reject'} destructive={decision === 'reject'} loading={decide.isPending} onCancel={() => setDecision(null)} onConfirm={() => { if (decision) decide.mutate(decision); }} />
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
      <Txt variant="small" color="textSecondary">Never share passwords or sign-in codes. Use the review image upload for requested images, not text messages. A reviewer will explain what is needed before requesting secure capture.</Txt>
    </View>}
  </Screen>;
}
