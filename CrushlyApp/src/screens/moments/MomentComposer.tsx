import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, TextInput, View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Photo } from '../../components/Photo';
import { IconButton } from '../../components/IconButton';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { createMoment } from '../../api/service';
import { keys } from '../../api/hooks';
import type { MomentStyle } from '../../api/types';
import { MOMENT_STYLES } from '../../lib/catalog';
import { pickImage, type PickedImage } from '../../lib/media';
import * as ImagePicker from 'expo-image-picker';
import { EditedClip } from '../../components/EditedClip';
import { ProgressBar } from '../../components/States';
import { splitForUpload, emptyEdit, playbackLength, type VideoEdit } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import { useLiveCamera } from '../../components/CameraCapture';
import { takeTrimResult } from '../common/VideoTrimScreen';
import { VIDEO_ENABLED } from '../../lib/features';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';
import { LocalDraftsSheet, LeaveDraftSheet } from '../../components/LocalDraftsSheet';
import { deleteLocalDraft, localDraftsAvailable, saveLocalDraft, type LocalDraft } from '../../lib/localDrafts';
import { useAuth } from '../../state/auth';

export function MomentComposerScreen({ navigation }: ScreenProps<'MomentComposer'>) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The tall Moment preview can put the focused text below the keyboard on
  // short phones. Once the keyboard settles, scroll the actual input into view.
  const revealInput = () => {
    if (Platform.OS === 'web' || keyboardTop.current == null) return;
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      inputRef.current?.measureInWindow((_x, y, _width, height) => {
        if (keyboardTop.current == null) return;
        const overlap = y + height - (keyboardTop.current - 76);
        if (overlap > 0) scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
      });
    }, 150);
  };
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      revealInput();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = null; });
    return () => {
      show.remove(); hide.remove();
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, []);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const allowLeaving = useRef(false);
  const pendingLeave = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [mode, setMode] = useState<'text' | 'photo' | 'video'>('text');
  const [body, setBody] = useState('');
  const [style, setStyle] = useState<MomentStyle>('champagne');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [clip, setClip] = useState<{ uri: string; mimeType: string; durationMs: number } | null>(null);
  const [pendingClip, setPendingClip] = useState<{ uri: string; mimeType: string; durationMs: number } | null>(null);
  const [clipEdit, setClipEdit] = useState<VideoEdit | null>(null);
  const [audience, setAudience] = useState<'everyone' | 'connections'>('everyone');
  const [busy, setBusy] = useState(false);

  const w = Math.min(contentWidth - gutter * 2, 360);
  const h = w * 1.4;
  const s = MOMENT_STYLES[style];
  const max = mode === 'text' ? 280 : 200;
  const ready = mode === 'text' ? body.trim().length > 0 : mode === 'photo' ? !!photo : !!clip;
  const hasWork = !!body.trim() || !!photo || !!clip;
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaving.current || !hasWork) return;
    event.preventDefault(); pendingLeave.current = event.data.action; setLeaveOpen(true);
  }), [navigation, hasWork]);
  const leave = () => {
    allowLeaving.current = true; setLeaveOpen(false);
    const action = pendingLeave.current; pendingLeave.current = null;
    if (action) navigation.dispatch(action); else navigation.goBack();
  };
  const saveDraft = async () => {
    if (!localDraftsAvailable || !me?.id || savingDraft || !hasWork) return;
    setSavingDraft(true);
    try {
      const files: Record<string, string> = {};
      if (photo) files.photo = photo.uri;
      if (clip) files.clip = clip.uri;
      const musicUri = clipEdit?.music?.uri;
      if (musicUri && /^(file|content):\/\//i.test(musicUri)) files.music = musicUri;
      await saveLocalDraft(me.id, { kind: 'moment', body, data: {
        mode, style, audience, photo: photo ? { mimeType: photo.mimeType } : null,
        clip: clip ? { mimeType: clip.mimeType, durationMs: clip.durationMs } : null, clipEdit,
      }, files }, draftId);
      toast({ kind: 'success', title: 'Draft saved on this phone' });
      leave();
    } catch {
      toast({ kind: 'error', title: 'Draft not saved', message: 'Your work is still here. Check phone storage and try again.' });
    } finally { setSavingDraft(false); }
  };
  const openDraft = (draft: LocalDraft) => {
    const d = draft.data as { mode?: 'text' | 'photo' | 'video'; style?: MomentStyle; audience?: 'everyone' | 'connections'; photo?: {mimeType: string} | null; clip?: {mimeType: string; durationMs: number} | null; clipEdit?: VideoEdit | null };
    setBody(draft.body); setMode(d.mode ?? 'text'); setStyle(d.style ?? 'champagne'); setAudience(d.audience ?? 'everyone');
    setPhoto(d.photo && draft.files.photo ? { ...d.photo, uri: draft.files.photo } : null);
    setClip(d.clip && draft.files.clip ? { ...d.clip, uri: draft.files.clip } : null);
    setClipEdit(d.clipEdit && draft.files.music && d.clipEdit.music
      ? { ...d.clipEdit, music: { ...d.clipEdit.music, uri: draft.files.music } } : d.clipEdit ?? null); setDraftId(draft.id); setDraftsOpen(false);
  };

  const cam = useLiveCamera();

  // Returning from the simple Moment trim keeps the selected video section.
  // If the user cancelled, clear the pending clip so they can pick again.
  useFocusEffect(
    useCallback(() => {
      const result = takeTrimResult();
      if (result && pendingClip) {
        setClip(pendingClip);
        setPendingClip(null);
        setMode('video');
        setClipEdit(result.edit ?? emptyEdit(pendingClip.durationMs ? pendingClip.durationMs / 1000 : 0));
      } else if (!result && pendingClip) {
        setPendingClip(null);
      }
    }, [pendingClip])
  );

  // What the player draws over the clip: the words, the stickers and the look.
  // The cut itself is written into the file when the Moment is shared.
  const liveEdit = clipEdit ? splitForUpload(clipEdit, 'moment').live : null;

  const choosePhoto = async (camera = false) => {
    const img = await (camera ? cam.capture() : pickImage());
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    setPhoto(img);
    setMode('photo');
  };

  const chooseClip = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: 60, // Moments allow up to one minute
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      let sourceUri = asset.uri;
      if (Platform.OS === 'web') {
        try {
          const response = await fetch(asset.uri, { cache: 'no-store' });
          if (response.ok) sourceUri = URL.createObjectURL(await response.blob());
        } catch {
          // Retain the picker URI if pinning the browser blob is unavailable.
        }
      }
      setPendingClip({
        uri: sourceUri,
        mimeType: asset.mimeType || 'video/mp4',
        durationMs: asset.duration ?? 0,
      });
      navigation.navigate('VideoTrim', {
        sourceUri,
        sourceDuration: (asset.duration ?? 0) / 1000,
        category: 'moment',
      });
    } catch (e) {
      toast({ kind: 'error', title: 'Clip not added', message: (e as Error).message });
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const prepared = clip ? await preparedClip(clipEdit, clip.uri, 'moment') : null;
      const durationMs = clip
        ? Math.max(100, Math.min(60_000, Math.round(playbackLength(clipEdit ?? emptyEdit((clip.durationMs || 0) / 1000)) * 1000)))
        : null;
      await createMoment({
        kind: mode,
        body: body.trim(),
        style,
        audience,
        photoUri: photo?.uri,
        photoMime: photo?.mimeType,
        videoUri: prepared ? prepared.uri ?? undefined : clip?.uri,
        videoMime: clip?.mimeType,
        durationMs,
        edit: prepared ? prepared.live : null,
      });
      qc.invalidateQueries({ queryKey: keys.moments });
      toast({ kind: 'success', title: 'Your Moment is live', message: 'It’ll disappear in 24 hours.' });
      if (draftId && me?.id) await deleteLocalDraft(me.id, draftId).catch(() => undefined);
      allowLeaving.current = true;
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Moment not shared', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboard scrollProps={{ ref: scrollRef, onScroll: (event) => { scrollY.current = event.nativeEvent.contentOffset.y; }, scrollEventThrottle: 16 }} footer={<View style={{ flexDirection: 'row', gap: space.sm }}>
      {localDraftsAvailable && me?.id ? <Button title="Save draft" variant="outline" size="md" style={{ flex: 1 }} onPress={() => void saveDraft()} disabled={!hasWork || busy || savingDraft} loading={savingDraft} /> : null}
      <Button title="Share Moment" size="md" style={{ flex: 1 }} onPress={share} disabled={!ready || savingDraft} loading={busy} />
    </View>}>
      <Header title="New Moment" subtitle="Share a glimpse. Gone in 24 hours." right={<IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />} />
      {cam.node}
      {localDraftsAvailable && me?.id && !hasWork ? <Button title="Drafts on this phone" size="sm" variant="ghost" full={false} onPress={() => setDraftsOpen(true)} /> : null}
      <LocalDraftsSheet visible={draftsOpen} owner={me?.id ?? 0} kind="moment" onClose={() => setDraftsOpen(false)} onOpen={openDraft} />
      <LeaveDraftSheet visible={leaveOpen} canSave={localDraftsAvailable && !!me?.id && hasWork} saving={savingDraft} onSave={() => void saveDraft()} onDiscard={leave} onClose={() => { pendingLeave.current = null; setLeaveOpen(false); }} />

      <Segmented<'text' | 'photo' | 'video'>
        value={mode}
        onChange={(m) => {
          if (m === 'photo' && !photo) return choosePhoto();
          if (m === 'video' && !clip) {
            setMode('video');
            return chooseClip();
          }
          setMode(m);
        }}
        // The Clip choice is behind the same switch as every other video
        // surface: a Moment can be words or a photo in this build.
        options={[
          { value: 'text', label: 'Words' },
          { value: 'photo', label: 'Photo' },
          ...(VIDEO_ENABLED ? [{ value: 'video' as const, label: 'Clip' }] : []),
        ]}
      />

      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <View style={{ width: w, height: h, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.card }}>
          {mode === 'video' && clip ? (
            <>
              <EditedClip uri={clip.uri} live={liveEdit} style={{ width: w, height: h }} autoPlay />
              <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 }}>
                <IconButton icon="images-outline" variant="glass" label="Choose another clip" onPress={chooseClip} />
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <TextInput
                  ref={inputRef}
                  onFocus={revealInput}
                  value={body}
                  onChangeText={setBody}
                  placeholder="Add a caption…"
                  placeholderTextColor="rgba(255,255,255,0.65)"
                  maxLength={max}
                  multiline
                  accessibilityLabel="Caption"
                  style={[{ color: '#fff', fontFamily: fonts.medium, fontSize: 16 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
                />
              </View>
            </>
          ) : mode === 'photo' && photo ? (
            <>
              <Photo uri={photo.uri} style={{ width: w, height: h }} contentPosition="center" alt="Selected photo" />
              <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 }}>
                <IconButton icon="images-outline" variant="glass" label="Choose another photo" onPress={() => choosePhoto()} />
                <IconButton icon="camera-outline" variant="glass" label="Take a photo" onPress={() => choosePhoto(true)} />
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <TextInput
                  ref={inputRef}
                  onFocus={revealInput}
                  value={body}
                  onChangeText={setBody}
                  placeholder="Add a caption…"
                  placeholderTextColor="rgba(255,255,255,0.65)"
                  maxLength={max}
                  multiline
                  accessibilityLabel="Caption"
                  style={[{ color: '#fff', fontFamily: fonts.medium, fontSize: 16 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
                />
              </View>
            </>
          ) : (
            <LinearGradient colors={s.colors} style={{ flex: 1, padding: space.xl, justifyContent: 'center' }}>
              <TextInput
                ref={inputRef}
                onFocus={revealInput}
                value={body}
                onChangeText={setBody}
                placeholder="What’s the moment?"
                placeholderTextColor={s.ink + '88'}
                maxLength={max}
                multiline
                accessibilityLabel="Your Moment"
                style={[{ color: s.ink, fontFamily: fonts.display, fontSize: 26, lineHeight: 34, textAlign: 'left' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
              />
            </LinearGradient>
          )}
        </View>
        <Txt variant="caption" color="textMuted" style={{ marginTop: 6, alignSelf: 'flex-end', marginRight: (contentWidth - gutter * 2 - w) / 2 }}>
          {body.length}/{max}
        </Txt>
      </View>

      {mode === 'text' ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm }}>
            Mood
          </Txt>
          <View style={{ flexDirection: 'row', gap: 12 }} accessibilityRole="radiogroup">
            {(Object.keys(MOMENT_STYLES) as MomentStyle[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => setStyle(k)}
                accessibilityRole="radio"
                accessibilityState={{ selected: style === k }}
                accessibilityLabel={MOMENT_STYLES[k].label}
                style={{ width: 44, height: 44, borderRadius: 22, padding: 3, borderWidth: 2, borderColor: style === k ? colors.gold : 'transparent' }}
              >
                <LinearGradient colors={MOMENT_STYLES[k].colors} style={{ flex: 1, borderRadius: 20, borderWidth: 1, borderColor: colors.border }} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {mode === 'video' && clip ? (
        <View style={{ marginTop: space.md, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Txt variant="smallStrong">Clip length</Txt>
            <Txt variant="smallStrong" color="gold">
              {`${Math.floor((clipEdit ? playbackLength(clipEdit) : clip.durationMs / 1000) / 60)}:${String(Math.floor((clipEdit ? playbackLength(clipEdit) : clip.durationMs / 1000) % 60)).padStart(2, '0')} / 1:00`}
            </Txt>
          </View>
          <ProgressBar
            value={Math.min(1, (clipEdit ? playbackLength(clipEdit) : clip.durationMs / 1000) / 60)}
            label="Moment clip length, up to one minute"
            style={{ height: 6 }}
          />
          <Button
            title="Adjust clip length"
            icon="resize-outline"
            variant="secondary"
            onPress={() => {
              setPendingClip(clip);
              navigation.navigate('VideoTrim', {
                sourceUri: clip.uri,
                sourceDuration: (clip.durationMs || 0) / 1000,
                category: 'moment',
                initialEdit: clipEdit ?? undefined,
              });
            }}
            accessibilityLabel="Adjust Moment clip length"
          />
          <Txt variant="caption" color="textMuted">
            Choose up to 1 minute. Your Moment disappears in 24 hours.
          </Txt>
        </View>
      ) : null}

      <View style={{ marginTop: space.lg }}>
        <Txt variant="label" color="textSecondary" style={{ marginBottom: space.sm }}>
          Who can see it
        </Txt>
        <Segmented<'everyone' | 'connections'>
          value={audience}
          onChange={setAudience}
          options={[
            { value: 'everyone', label: 'Everyone nearby' },
            { value: 'connections', label: 'Connections' },
          ]}
        />
      </View>

    </Screen>
  );
}
