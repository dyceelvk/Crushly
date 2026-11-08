import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { BottomSheet, ConfirmSheet } from '../../components/BottomSheet';
import { Photo } from '../../components/Photo';
import { ClipThumb } from '../../components/ClipThumb';
import { Segmented } from '../../components/Segmented';
import { Suggestions } from '../../components/Suggestions';
import { activeToken, applyToken } from '../../lib/mentions';
import { Pill } from '../../components/Badges';
import { PressableScale } from '../../components/PressableScale';
import { Rise } from '../../components/Rise';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { attachPostSound, createPost } from '../../api/service';
import { keys } from '../../api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { VideoEditorModal } from '../../components/VideoEditor';
import type { LiveEdit, VideoEdit } from '../../lib/videoEdit';
import { emptyEdit, splitForUpload } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import { takeTrimResult } from './VideoTrimScreen';
import { useTheme } from '../../theme/ThemeProvider';
import { VIDEO_ENABLED } from '../../lib/features';
import { radius, space } from '../../theme/tokens';
import { DownloadAppButton } from '../../components/DownloadAppButton';
import { LocalDraftsSheet, LeaveDraftSheet } from '../../components/LocalDraftsSheet';
import { deleteLocalDraft, localDraftsAvailable, saveLocalDraft, type LocalDraft } from '../../lib/localDrafts';
import { useAuth } from '../../state/auth';
import type { ScreenProps } from '../../navigation/types';

type MediaItem = {
  id: string;
  uri: string;
  mimeType: string;
  type: 'photo' | 'video';
  durationMs?: number;
  edit?: VideoEdit | null;
};

/** The two things a person can share, in the order the product grew them. */
type PostKind = 'flow' | 'moment';

const BOARDS: { kind: PostKind; title: string; blurb: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'flow', title: 'Post', blurb: 'Words, photos and clips. Stays until you take it down.', icon: 'albums-outline' },
  { kind: 'moment', title: 'Moment', blurb: 'One glimpse. Gone in 24 hours.', icon: 'aperture-outline' },
];

/**
 * Create Post — the composer for words, photos and clips.
 *
 * Video is offered again (`VIDEO_ENABLED`), and it goes trim-first: a clip opens
 * the dedicated trim screen the moment it is picked, then the full workbench for
 * cuts, looks, text and stickers. A photo goes straight in. A clip longer than a
 * minute is refused with a sentence rather than silently shortened.
 *
 * Layout follows the design: view at top, editors above tabs, tabs below
 * editors, add-text bar at the bottom.
 */
export function CreatePostScreen({ navigation, route }: ScreenProps<'CreatePost'>) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const allowLeaving = useRef(false);
  const pendingLeave = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);

  const twoCol = width >= 600;

  /**
   * What is being shared, chosen *before* the board is built.
   *
   * The composer used to ask this last — a "Post type" row of segments at the
   * bottom of a settings panel, after the photograph had already been picked
   * and the words already written. By then the answer changes nothing anyone
   * can see. So the question comes first, and each answer leads to the board
   * that is actually that thing.
   */
  const [kind, setKind] = useState<PostKind | null>(route.params?.type ?? null);
  /**
   * Set when this composer was opened from a sound page. The sound is attached
   * to the post *after* it exists — `create_post` keeps its signature, so a
   * second, tiny call does the attribution instead of a new overload that
   * PostgREST would have to choose between.
   */
  const [sound, setSound] = useState<{ id: number; label: string } | null>(
    route.params?.soundId
      ? { id: route.params.soundId, label: route.params.soundLabel ?? 'Original sound' }
      : null,
  );

  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'connections'>('everyone');
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingMedia, setPendingMedia] = useState<MediaItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [editorTool, setEditorTool] = useState<'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null>(null);
  const MAX_MEDIA = 1;
  const MAX_VIDEO_SECONDS = 60;

  const primaryMedia = media[0];

  // When returning from the shared video workbench, keep its full edit recipe.
  useFocusEffect(
    useCallback(() => {
      const result = takeTrimResult();
      if (result && pendingMedia) {
        // Keep the complete workbench recipe, not just its outer trim, so cuts,
        // text, stickers and looks survive the trip back to the composer.
        const sourceDuration = (pendingMedia.durationMs ?? 0) / 1000;
        setMedia((prev) => [
          ...prev,
          { ...pendingMedia, edit: result.edit ?? emptyEdit(sourceDuration) },
        ]);
        setPendingMedia(null);
      } else if (!result && pendingMedia) {
        setPendingMedia(null);
      }
    }, [pendingMedia])
  );

  const ready = body.trim().length > 0 || media.length > 0;

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaving.current || (!ready && !sound)) return;
    event.preventDefault();
    pendingLeave.current = event.data.action;
    setLeaveOpen(true);
  }), [navigation, ready, sound]);

  const leave = () => {
    allowLeaving.current = true;
    setLeaveOpen(false);
    const action = pendingLeave.current;
    pendingLeave.current = null;
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  };
  const saveDraft = async () => {
    if (!localDraftsAvailable || !me?.id || savingDraft) return;
    setSavingDraft(true);
    try {
      const item = primaryMedia;
      const files: Record<string, string> = item ? { media: item.uri } : {};
      const musicUri = item?.edit?.music?.uri;
      if (musicUri && /^(file|content):\/\//i.test(musicUri)) files.music = musicUri;
      await saveLocalDraft(me.id, {
        kind: 'post', body,
        data: { audience, commentsEnabled, sound, media: item ? { ...item, uri: undefined } : null },
        files,
      }, draftId);
      toast({ kind: 'success', title: 'Draft saved on this phone' });
      leave();
    } catch {
      toast({ kind: 'error', title: 'Draft not saved', message: 'Your work is still here. Check phone storage and try again.' });
    } finally { setSavingDraft(false); }
  };
  const openDraft = (draft: LocalDraft) => {
    const d = draft.data as { audience?: 'everyone' | 'connections'; commentsEnabled?: boolean; sound?: {id: number; label: string} | null; media?: Omit<MediaItem, 'uri'> | null };
    setBody(draft.body); setAudience(d.audience ?? 'everyone'); setCommentsEnabled(d.commentsEnabled ?? true); setSound(d.sound ?? null);
    const edit = d.media?.edit && draft.files.music && d.media.edit.music
      ? { ...d.media.edit, music: { ...d.media.edit.music, uri: draft.files.music } } : d.media?.edit;
    setMedia(d.media && draft.files.media ? [{ ...d.media, edit, uri: draft.files.media }] : []);
    setDraftId(draft.id); setKind('flow'); setDraftsOpen(false);
  };
  const draftsUi = <>
    <LocalDraftsSheet visible={draftsOpen} owner={me?.id ?? 0} kind="post" onClose={() => setDraftsOpen(false)} onOpen={openDraft} />
    <LeaveDraftSheet visible={leaveOpen} canSave={localDraftsAvailable && !!me?.id && ready} saving={savingDraft} onSave={() => void saveDraft()} onDiscard={leave} onClose={() => { pendingLeave.current = null; setLeaveOpen(false); }} />
  </>;

  const pickMedia = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        // Both, now that clips are part of the product. The picker's own limit
        // is the first of the checks; the composer's is the one that decides.
        mediaTypes: VIDEO_ENABLED ? ImagePicker.MediaTypeOptions.All : ImagePicker.MediaTypeOptions.Images,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        quality: 0.8,
        allowsMultipleSelection: false,
        selectionLimit: 1,
      });
      if (result.canceled || !result.assets?.length) return;

      for (const asset of result.assets) {
        const isVideo = asset.type === 'video' || !!asset.mimeType?.startsWith('video/');
        const durationMs = asset.duration ?? 0;

        if (isVideo && durationMs > MAX_VIDEO_SECONDS * 1000) {
          toast({ kind: 'error', title: 'That clip is too long', message: 'Posts can carry up to one minute of video.' });
          continue;
        }

        const item: MediaItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          mimeType: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
          type: isVideo ? 'video' : 'photo',
          durationMs,
        };

        // On web, expo-image-picker's blob: URIs can be revoked when the picker
        // closes or when navigating to/from the trim screen. Pin the file by
        // reading it into our own blob URL so it survives until upload.
        if (isVideo && Platform.OS === 'web') {
          try {
            const res = await fetch(asset.uri, { cache: 'no-store' });
            if (res.ok) {
              const blob = await res.blob();
              item.uri = URL.createObjectURL(blob);
            }
          } catch {
            // keep the original URI
          }
        }

        if (isVideo) {
          // Videos go trim-first before anything else.
          setPendingMedia(item);
          navigation.navigate('VideoTrim', {
            sourceUri: item.uri,
            sourceDuration: durationMs / 1000,
            category: 'post',
          });
          return; // one video at a time through the trim screen
        }

        setMedia((prev) => [...prev, item]);
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t add media', message: (e as Error).message });
    }
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => prev.filter((m) => m.id !== id));
  };

  const openEditor = (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => {
    if (!primaryMedia) return;
    setEditingMediaId(primaryMedia.id);
    setEditorTool(tool ?? null);
    setEditorOpen(true);
  };

  const post = async () => {
    setBusy(true);
    try {
      const first = primaryMedia;
      let videoUri: string | undefined = undefined;
      let videoMime: string | undefined = undefined;
      let edit: LiveEdit | null = null;

      if (first?.type === 'video') {
        const prepared = await preparedClip(first.edit ?? emptyEdit(0), first.uri, 'post');
        videoUri = prepared.uri ?? first.uri;
        videoMime = first.mimeType;
        edit = prepared.live;
      } else if (first?.type === 'photo') {
        edit = first.edit ? splitForUpload(first.edit, 'post').live : null;
      }

      const created = await createPost({
        body: body.trim(),
        audience,
        commentsEnabled,
        photoUri: first?.type === 'photo' ? first.uri : undefined,
        photoMime: first?.type === 'photo' ? first.mimeType : undefined,
        videoUri,
        videoMime,
        edit,
      });

      // The clip is posted either way; a sound that failed to attach is worth a
      // warning, not a lie that the post was not shared.
      if (sound && created?.id) {
        try {
          await attachPostSound(created.id, sound.id);
        } catch (e) {
          console.warn('attachPostSound failed:', e);
          toast({ kind: 'error', title: 'Sound not attached', message: 'Your post is live, but without that sound.' });
        }
      }

      void qc.invalidateQueries({ queryKey: keys.flow });
      void qc.invalidateQueries({ queryKey: keys.crushesFeed });
      void qc.invalidateQueries({ queryKey: keys.publicFlow });
      void qc.invalidateQueries({ queryKey: ['space-posts'] });
      void qc.invalidateQueries({ queryKey: keys.me });
      toast({ kind: 'success', title: 'Post shared' });
      if (draftId && me?.id) await deleteLocalDraft(me.id, draftId).catch(() => undefined);
      allowLeaving.current = true;
      navigation.goBack();
    } catch (e) {
      // The toast washes technical detail out of the sentence it shows, which is
      // right for a member and useless for us — so the real reason goes to the
      // console, where it survives in a bug report.
      console.warn('createPost failed:', e);
      toast({ kind: 'error', title: 'Post not shared', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const canPost = !busy && ready;

  const rightPanelWidth = 340;

  /**
   * The question, asked first.
   *
   * Two cards, one of which is the thing you already had in mind. Choosing a
   * Moment hands over to the screen that has always been that, rather than
   * pretending a Flow with a different label on it is one.
   */
  if (!kind) {
    const choose = (next: PostKind) => {
      if (next === 'moment') {
        navigation.replace('MomentComposer');
        return;
      }
      setKind(next);
    };
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.sm,
            width: '100%', maxWidth: contentWidth, alignSelf: 'center',
          }}
        >
          <IconButton icon="close" label="Cancel" onPress={() => navigation.goBack()} />
          <Txt variant="title" style={{ flex: 1 }} accessibilityRole="header">
            Share something
          </Txt>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: insets.bottom + space.xxl,
            gap: space.sm, width: '100%', maxWidth: contentWidth, alignSelf: 'center',
          }}
          showsVerticalScrollIndicator={false}
        >
          {localDraftsAvailable && me?.id ? <Button title="Drafts on this phone" variant="outline" size="md" onPress={() => setDraftsOpen(true)} disabled={ready} /> : null}
          {BOARDS.map((b, i) => (
            <Rise key={b.kind} delay={i * 70}>
            <PressableScale
              onPress={() => choose(b.kind)}
              pressedScale={0.985}
              accessibilityRole="button"
              accessibilityLabel={`${b.title}. ${b.blurb}`}
            >
              <View
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: space.md,
                  padding: space.md, borderRadius: radius.lg,
                  backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                }}
              >
                <View
                  style={{
                    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: colors.goldSoft ?? colors.elevated,
                  }}
                >
                  <Ionicons name={b.icon} size={21} color={colors.gold} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="heading">{b.title}</Txt>
                  <Txt variant="small" color="textSecondary">
                    {b.blurb}
                  </Txt>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </View>
            </PressableScale>
            </Rise>
          ))}
        </ScrollView>
        {draftsUi}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: insets.top + space.sm,
          paddingHorizontal: gutter,
          paddingBottom: space.sm,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
      >
        <IconButton icon="close" label="Cancel" onPress={() => navigation.goBack()} />
        <Txt variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {kind === 'moment' ? 'New Moment' : 'New Crush'}
        </Txt>
        {/* On the web, the editor is where somebody is most obviously writing a
            Crush in a browser — so it is also where they are offered the app
            they could be writing it in. Hidden on Android, where it is already
            installed. */}
        <DownloadAppButton />
        {/* Back to the question. Changing your mind about what this is should
            cost one tap, not a discarded draft. */}
        <Button
          title="Change"
          size="sm"
          variant="ghost"
          onPress={() => setKind(null)}
          accessibilityLabel="Choose a different kind of post"
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.lg,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {localDraftsAvailable && me?.id && !ready ? <Button title="Drafts on this phone" variant="ghost" size="sm" full={false} onPress={() => setDraftsOpen(true)} /> : null}
        {twoCol ? (
          <View style={{ flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' }}>
            {/* Left column — composer */}
            <View style={{ flex: 1, minWidth: 0 }}>
            <ComposerLeft
              body={body}
              setBody={setBody}
              audience={audience}
              setAudience={setAudience}
              commentsEnabled={commentsEnabled}
              openAdvanced={() => setAdvancedOpen(true)}
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
            />
            </View>

            {/* Right column — preview + settings */}
            <View style={{ width: rightPanelWidth, minWidth: 0 }}>
              <ComposerRight primaryMedia={primaryMedia} />
            </View>
          </View>
        ) : (
          <View style={{ gap: space.lg, minWidth: 0 }}>
            <ComposerLeft
              body={body}
              setBody={setBody}
              audience={audience}
              setAudience={setAudience}
              commentsEnabled={commentsEnabled}
              openAdvanced={() => setAdvancedOpen(true)}
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
            />
            <ComposerRight primaryMedia={primaryMedia} />
          </View>
        )}

        {sound ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginHorizontal: gutter,
              marginBottom: space.sm,
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Ionicons name="musical-notes" size={15} color={colors.gold} />
            <Txt numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.text }}>
              {sound.label}
            </Txt>
            <Pressable onPress={() => setSound(null)} accessibilityRole="button" accessibilityLabel="Remove this sound" hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        {busy ? (
          <View style={{ alignItems: 'center', paddingVertical: space.lg }}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Txt variant="small" color="textSecondary" style={{ marginTop: 10 }}>
              Sharing your post…
            </Txt>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingHorizontal: gutter }}>
            {localDraftsAvailable && me?.id ? <Button title="Save draft" size="sm" variant="outline" full={false} onPress={() => void saveDraft()} disabled={!ready || savingDraft} loading={savingDraft} /> : null}
            <Button title="Reset" size="sm" variant="ghost" full={false} onPress={() => setConfirmReset(true)} accessibilityLabel="Reset post" />
            <Button
              title="Post"
              full={false}
              icon="paper-plane"
              variant="primary"
              disabled={!canPost}
              loading={busy}
              onPress={post}
              accessibilityLabel="Publish your post"
            />
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={advancedOpen} onClose={() => setAdvancedOpen(false)} title="Advanced options">
        <View style={{ gap: space.md }}>
          <Pressable onPress={() => setCommentsEnabled((v) => !v)} accessibilityRole="switch"
            accessibilityLabel="Allow comments" accessibilityState={{ checked: commentsEnabled }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Allow comments</Txt>
              <Txt variant="small" color="textSecondary">Choose whether people can comment on this post.</Txt>
            </View>
            <View style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: commentsEnabled ? colors.primary : colors.elevated, justifyContent: 'center', alignItems: commentsEnabled ? 'flex-end' : 'flex-start', paddingHorizontal: 4 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }} />
            </View>
          </Pressable>
          <Txt variant="bodyStrong">Remix</Txt>
          <Txt variant="small" color="textSecondary">Remixing is not available yet. There is no remix permission to enable.</Txt>
          <Button title="Done" size="sm" onPress={() => setAdvancedOpen(false)} />
        </View>
      </BottomSheet>
      <ConfirmSheet visible={confirmReset} title="Reset this post?" message="This clears the words, media and post settings."
        confirmLabel="Reset post" destructive onCancel={() => setConfirmReset(false)} onConfirm={() => {
          setBody(''); setMedia([]); setPendingMedia(null); setAudience('everyone');
          setCommentsEnabled(true); setSound(null); setDraftId(null); setConfirmReset(false);
        }} />

      {draftsUi}
      <VideoEditorModal
        visible={editorOpen}
        sourceUri={primaryMedia?.uri ?? null}
        sourceDuration={primaryMedia?.durationMs ? primaryMedia.durationMs / 1000 : 0}
        category="post"
        initialTool={editorTool}
        initialEdit={primaryMedia?.edit ?? null}
        onCancel={() => setEditorOpen(false)}
        onDone={(r) => {
          setMedia((prev) =>
            prev.map((m) => (m.id === editingMediaId ? { ...m, edit: r.edit } : m))
          );
          setEditorOpen(false);
          setEditingMediaId(null);
          setEditorTool(null);
        }}
      />
    </View>
  );
}

/** Left column: text input, media grid, post settings. */
function ComposerLeft({
  body,
  setBody,
  audience,
  setAudience,
  commentsEnabled,
  openAdvanced,
  media,
  removeMedia,
  pickMedia,
  primaryMedia,
  openEditor,
}: {
  body: string;
  setBody: React.Dispatch<React.SetStateAction<string>>;
  audience: 'everyone' | 'connections';
  setAudience: (v: 'everyone' | 'connections') => void;
  commentsEnabled: boolean;
  openAdvanced: () => void;
  media: MediaItem[];
  removeMedia: (id: string) => void;
  pickMedia: () => void;
  primaryMedia: MediaItem | undefined;
  openEditor: (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => void;
}) {
  // The caret lives here, beside the words it moves through: the input, the
  // suggestion list and the @ / # buttons are all in this column.
  const [caret, setCaret] = useState<number | null>(null);
  const token = activeToken(body, caret);
  const insertSigil = (sigil: '@' | '#') => {
    const sep = body && !/\s$/.test(body) ? ' ' : '';
    const next = `${body}${sep}${sigil}`;
    setBody(next);
    setCaret(next.length);
  };

  const { colors } = useTheme();

  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Main view — media grid above */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Add Media
          </Txt>
          <Txt variant="caption" color="textMuted">
            One photo or video, or just words
          </Txt>
        </View>
        {media.map((m) => (
          <View key={m.id} style={{ position: 'relative', width: 88, height: 88, borderRadius: 16, overflow: 'hidden' }}>
            {m.type === 'video' ? (
              <ClipThumb uri={m.uri} style={{ width: '100%', height: '100%' }} />
            ) : (
              <Photo uri={m.uri} style={{ width: '100%', height: '100%' }} alt="Selected photo" />
            )}
            <Pressable onPress={() => removeMedia(m.id)} accessibilityLabel="Remove media" hitSlop={8} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close-outline" size={16} color="#fff" />
            </Pressable>
            {m.type === 'video' && (
              <Pressable onPress={() => openEditor()} accessibilityLabel="Edit video" hitSlop={8} style={{ position: 'absolute', bottom: 4, left: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="color-wand-outline" size={14} color="#fff" />
              </Pressable>
            )}
          </View>
        ))}
        {media.length < 1 && (
          <Pressable onPress={pickMedia} accessibilityLabel="Add media" hitSlop={12} style={{ width: 88, height: 88, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={24} color={colors.gold} />
          </Pressable>
        )}
      </View>

      {/* Text bar — below main view */}
      <View style={{ gap: space.sm }}>
        <Txt variant="label" color="textSecondary">
          What's on your mind?
        </Txt>
        <Input
          multiline
          value={body}
          onChangeText={(t) => {
            setBody(t);
            // Typing replaces the selection, so the caret is at the end of what
            // was just typed unless the platform says otherwise.
            setCaret(t.length);
          }}
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
          placeholder="Good energy, better days. Same me, just more focused."
          maxLength={500}
          showCount
          style={{ minHeight: 150 }}
        />

        {/* The list that answers a `@` or a `#`, right where the words are. */}
        <Suggestions
          token={token}
          onPick={(choice) => {
            if (!token) return;
            const next = applyToken(body, token, choice);
            setBody(next.text);
            setCaret(next.caret);
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, flexWrap: 'wrap' }}>
          {/* Video tools are available only for a selected video. */}
          {primaryMedia?.type === 'video' ? <>
          <Pressable onPress={() => openEditor('crop')} accessibilityLabel="Crop" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="crop-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('filters')} accessibilityLabel="Filter" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="color-wand-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('adjust')} accessibilityLabel="Adjust" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="sunny-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('captions')} accessibilityLabel="Text" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="text-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('stickers')} accessibilityLabel="Stickers" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="happy-outline" size={18} color={colors.textMuted} />
          </Pressable>

          </> : null}

          {/* Tag people */}
          <Pressable
            onPress={() => insertSigil('@')}
            accessibilityLabel="Tag someone"
            hitSlop={12}
            style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}
          >
            <Txt variant="caption" style={{ color: colors.text }}>@</Txt>
          </Pressable>

          {/* Hashtag */}
          <Pressable
            onPress={() => insertSigil('#')}
            accessibilityLabel="Add hashtag"
            hitSlop={12}
            style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}
          >
            <Txt variant="caption" style={{ color: colors.text }}>#</Txt>
          </Pressable>

          {/* Public / private toggle */}
          <Pressable onPress={() => setAudience(audience === 'everyone' ? 'connections' : 'everyone')} accessibilityLabel="Public or private" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name={audience === 'everyone' ? 'globe' : 'lock-closed'} size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>


      {/* Audience */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="label" color="textSecondary">Audience</Txt>
          <Txt variant="caption" color="textMuted">{audience === 'everyone' ? 'Everyone / Public' : 'Connections'}</Txt>
        </View>
        <Segmented<'everyone' | 'connections'>
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'connections', label: 'Connections' },
          ]}
          value={audience}
          onChange={setAudience}
        />
      </View>

      {/* Tag people */}
      <SettingsRow label="Tag people" hint="Mention friends or creators in your words" icon="person-outline" onPress={() => insertSigil('@')} />

      {/* What this is. Stated, not asked: it was answered one screen ago, and
          answering it here again used to change nothing. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Txt variant="label" color="textSecondary">Sharing</Txt>
          <Txt variant="caption" color="textMuted">
            A post — public, or for your connections
          </Txt>
        </View>
        <Pill label="Post" tone="gold" />
      </View>

      <SettingsRow label="Advanced options" hint={commentsEnabled ? 'Comments on · Remix unavailable' : 'Comments off · Remix unavailable'} icon="options-outline" onPress={openAdvanced} />

    </View>
  );
}

/** Preview the selected file, not a placeholder pretending to be the post. */
function ComposerRight({
  primaryMedia,
}: {
  primaryMedia: MediaItem | undefined;
}) {

  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Media preview */}
      {primaryMedia ? (
        <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', aspectRatio: primaryMedia.type === 'video' ? 9 / 16 : 1 }}>
          {primaryMedia.type === 'video' ? (
            <ClipThumb uri={primaryMedia.uri} contentFit="contain" style={{ width: '100%', height: '100%' }} />
          ) : (
            <Photo uri={primaryMedia.uri} fit="contain" style={{ width: '100%', height: '100%' }} alt="Selected photo" />
          )}
        </View>
      ) : null}


    </View>
  );
}

/** Reusable setting row with chevron. */
function SettingsRow({ label, hint, icon, onPress }: { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={12}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name={icon} size={20} color={colors.textMuted} />
        <View style={{ gap: 2 }}>
          <Txt variant="bodyStrong" color="text" numberOfLines={1}>
            {label}
          </Txt>
          <Txt variant="caption" color="textMuted">
            {hint}
          </Txt>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}
