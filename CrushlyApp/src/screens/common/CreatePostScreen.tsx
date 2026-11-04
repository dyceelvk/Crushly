import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { Segmented } from '../../components/Segmented';
import { Suggestions } from '../../components/Suggestions';
import { activeToken, applyToken, tokenKey } from '../../lib/mentions';
import { Pill } from '../../components/Badges';
import { PressableScale } from '../../components/PressableScale';
import { Rise } from '../../components/Rise';
import { useLayout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { useCreatePost } from '../../api/hooks';
import { attachPostSound, createPost } from '../../api/service';
import { keys } from '../../api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { VideoEditorModal } from '../../components/VideoEditor';
import type { LiveEdit, VideoEdit } from '../../lib/videoEdit';
import { emptyEdit, splitForUpload } from '../../lib/videoEdit';
import { preparedClip } from '../../lib/videoEncode';
import { takeTrimResult } from './VideoTrimScreen';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

type MediaItem = {
  id: string;
  uri: string;
  mimeType: string;
  type: 'photo' | 'video';
  durationMs?: number;
  edit?: VideoEdit | null;
};

type PostType = 'Flows' | 'Stories' | 'Moments';

/** The two things a person can share, in the order the product grew them. */
type PostKind = 'flow' | 'moment';

const BOARDS: { kind: PostKind; title: string; blurb: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'flow', title: 'Flow', blurb: 'Words, photos, a clip. Stays until you take it down.', icon: 'albums-outline' },
  { kind: 'moment', title: 'Moment', blurb: 'One glimpse. Gone in 24 hours.', icon: 'aperture-outline' },
];

/**
 * Create Post — unified composer for text, photo, and video posts.
 *
 * Layout follows the design: view at top, editors above tabs, tabs below
 * editors, add-text bar at the bottom. Video goes trim-first (dedicated trim
 * screen right after picking), then the full editor for captions/filters/etc.
 */
export function CreatePostScreen({ navigation, route }: ScreenProps<'CreatePost'>) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const create = useCreatePost();

  const isTablet = width >= 700;
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
  // Where the caret is, so `@` and `#` know which word is being built.
  const [caret, setCaret] = useState<number | null>(null);
  const token = activeToken(body, caret);
  const [audience, setAudience] = useState<'everyone' | 'connections'>('everyone');
  // A board knows what it is; there is nothing left to choose underneath it.
  const postType: PostType = 'Flows';
  const [scheduleOn, setScheduleOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pendingMedia, setPendingMedia] = useState<MediaItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [editorTool, setEditorTool] = useState<'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null>(null);
  const [fontIndex, setFontIndex] = useState(0);

  const FONT_OPTIONS = [
    fonts.regular,
    fonts.medium,
    fonts.semibold,
    fonts.bold,
    fonts.display,
    fonts.displayItalic,
  ] as const;

  const MAX_MEDIA = 10;
  const MAX_BODY = 500;
  const MAX_VIDEO_SECONDS = 60;

  const primaryMedia = media[0];
  const videoMedia = media.find((m) => m.type === 'video');

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

  const maxBody = MAX_BODY;
  const ready = body.trim().length > 0 || media.length > 0;

  const pickMedia = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: MAX_MEDIA - media.length,
      });
      if (result.canceled || !result.assets?.length) return;

      for (const asset of result.assets) {
        const isVideo = asset.mimeType?.startsWith('video/') ?? false;
        const sizeBytes = asset.fileSize ?? 0;
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

      qc.invalidateQueries({ queryKey: keys.flow });
      qc.invalidateQueries({ queryKey: keys.me });
      toast({ kind: 'success', title: 'Post shared' });
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

  const headerHeight = 60;
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
          {kind === 'moment' ? 'New Moment' : 'New Flow'}
        </Txt>
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
        {twoCol ? (
          <View style={{ flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' }}>
            {/* Left column — composer */}
            <View style={{ flex: 1, minWidth: 0 }}>
            <ComposerLeft
              body={body}
              setBody={setBody}
              audience={audience}
              setAudience={setAudience}
              postType={postType}
              scheduleOn={scheduleOn}
              setScheduleOn={setScheduleOn}
              maxBody={maxBody}
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
              editing={editingMediaId === primaryMedia?.id}
              fontIndex={fontIndex}
              setFontIndex={setFontIndex}
              fontOptions={FONT_OPTIONS}
            />
            </View>

            {/* Right column — preview + settings */}
            <View style={{ width: rightPanelWidth, minWidth: 0 }}>
              <ComposerRight
                primaryMedia={primaryMedia}
                media={media}
                postType={postType}
                audience={audience}
                body={body}
                maxBody={maxBody}
                openEditor={openEditor}
              />
            </View>
          </View>
        ) : (
          <View style={{ gap: space.lg, minWidth: 0 }}>
            <ComposerLeft
              body={body}
              setBody={setBody}
              audience={audience}
              setAudience={setAudience}
              postType={postType}
              scheduleOn={scheduleOn}
              setScheduleOn={setScheduleOn}
              maxBody={maxBody}
              media={media}
              removeMedia={removeMedia}
              pickMedia={pickMedia}
              primaryMedia={primaryMedia}
              openEditor={openEditor}
              editing={editingMediaId === primaryMedia?.id}
              fontIndex={fontIndex}
              setFontIndex={setFontIndex}
              fontOptions={FONT_OPTIONS}
            />
            <ComposerRight
              primaryMedia={primaryMedia}
              media={media}
              postType={postType}
              audience={audience}
              body={body}
              maxBody={maxBody}
              openEditor={openEditor}
            />
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
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: gutter }}>
            <Button title="Reset" size="sm" variant="ghost" onPress={() => {}} accessibilityLabel="Reset post" />
            <Button
              title="Post"
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
  postType,
  scheduleOn,
  setScheduleOn,
  maxBody,
  media,
  removeMedia,
  pickMedia,
  primaryMedia,
  openEditor,
  editing,
  fontIndex,
  setFontIndex,
  fontOptions,
}: {
  body: string;
  setBody: React.Dispatch<React.SetStateAction<string>>;
  audience: 'everyone' | 'connections';
  setAudience: (v: 'everyone' | 'connections') => void;
  postType: 'Flows' | 'Stories' | 'Moments';
  scheduleOn: boolean;
  setScheduleOn: (v: boolean) => void;
  maxBody: number;
  media: MediaItem[];
  removeMedia: (id: string) => void;
  pickMedia: () => void;
  primaryMedia: MediaItem | undefined;
  openEditor: (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => void;
  editing: boolean;
  fontIndex: number;
  setFontIndex: React.Dispatch<React.SetStateAction<number>>;
  fontOptions: readonly string[];
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

  const insertText = (text: string) => {
    setBody((prev) => (prev.trim().endsWith(text.trim()) ? prev : prev + ' ' + text));
  };

  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Main view — media grid above */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="label" color="textSecondary">
            Add Media
          </Txt>
          <Txt variant="caption" color="textMuted">
            Photos, videos or multiple files
          </Txt>
        </View>
        {media.map((m) => (
          <View key={m.id} style={{ position: 'relative', width: 88, height: 88, borderRadius: 16, overflow: 'hidden' }}>
            {m.type === 'video' ? (
              <View style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
                <Ionicons name="videocam-outline" size={24} color="#666" style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -12 }, { translateY: -12 }] }} />
              </View>
            ) : (
              <View style={{ width: '100%', height: '100%', backgroundColor: colors.card }} />
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
        {media.length < 10 && (
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
          style={{ minHeight: 150, fontFamily: fontOptions[fontIndex] }}
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
          {/* Media Settings — line up under the text bar */}
          <Pressable onPress={() => openEditor('crop')} accessibilityLabel="Crop" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="crop-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('filters')} accessibilityLabel="Filter" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="color-wand-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('adjust')} accessibilityLabel="Adjust" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="sunny-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('stickers')} accessibilityLabel="Draw" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="create-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('captions')} accessibilityLabel="Text" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="text-outline" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => openEditor('stickers')} accessibilityLabel="Stickers" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Ionicons name="happy-outline" size={18} color={colors.textMuted} />
          </Pressable>

          {/* Font cycle */}
          <Pressable onPress={() => setFontIndex((i) => (i + 1) % fontOptions.length)} accessibilityLabel="Change font" hitSlop={12} style={{ padding: 8, backgroundColor: colors.elevated, borderRadius: radius.sm }}>
            <Txt variant="caption" style={{ color: colors.text }}>Aa</Txt>
          </Pressable>

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

      {/* Location */}
      <SettingsRow label="Location" hint="Add a location (optional)" icon="location-outline" />

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
      <SettingsRow label="Tag people" hint="Mention friends or creators" icon="person-outline" />

      {/* What this is. Stated, not asked: it was answered one screen ago, and
          answering it here again used to change nothing. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Txt variant="label" color="textSecondary">Sharing</Txt>
          <Txt variant="caption" color="textMuted">
            A Flow — public, or for your connections
          </Txt>
        </View>
        <Pill label="Flow" tone="gold" />
      </View>

      {/* Advanced options */}
      <SettingsRow label="Advanced options" hint="Allow comments, remix, etc." icon="settings-outline" />

      {/* Schedule post */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Txt variant="label" color="textSecondary">Schedule post</Txt>
          <Txt variant="caption" color="textMuted">Post later (optional)</Txt>
        </View>
        <Pressable onPress={() => setScheduleOn(!scheduleOn)} accessibilityRole="switch" accessibilityState={{ checked: scheduleOn }} hitSlop={12} style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: scheduleOn ? colors.primary : colors.elevated, alignItems: scheduleOn ? 'flex-end' : 'flex-start', justifyContent: 'center', paddingHorizontal: 4 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', marginHorizontal: 3 }} />
        </Pressable>
      </View>

      <Button title="Reset" size="sm" variant="ghost" onPress={() => {}} accessibilityLabel="Reset post" />
    </View>
  );
}

/** Right column: media preview, settings panel, post preview. */
function ComposerRight({
  primaryMedia,
  media,
  postType,
  audience,
  body,
  maxBody,
  openEditor,
}: {
  primaryMedia: MediaItem | undefined;
  media: MediaItem[];
  postType: 'Flows' | 'Stories' | 'Moments';
  audience: 'everyone' | 'connections';
  body: string;
  maxBody: number;
  openEditor: (tool?: 'crop' | 'filters' | 'adjust' | 'stickers' | 'captions' | null) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      {/* Media preview */}
      {primaryMedia ? (
        <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', aspectRatio: primaryMedia.type === 'video' ? 9 / 16 : 1 }}>
          {primaryMedia.type === 'video' ? (
            <View style={{ width: '100%', height: '100%', backgroundColor: '#000' }}>
              <Ionicons name="videocam-outline" size={32} color="#666" style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -16 }, { translateY: -16 }] }} />
              <Pressable onPress={() => openEditor('filters')} accessibilityLabel="Edit media" hitSlop={12} style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="color-wand-outline" size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={() => openEditor()} accessibilityLabel="Close preview" hitSlop={12} style={{ position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close-outline" size={16} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View style={{ width: '100%', height: '100%', backgroundColor: colors.card }} />
          )}
        </View>
      ) : null}

      {/* Post Preview */}
      <Card title="Post Preview">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card }} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong" color="text" numberOfLines={1}>
              Crushly
            </Txt>
            <Txt variant="caption" color="textMuted" style={{ marginTop: 1 }}>
              Just now
            </Txt>
          </View>
        </View>
        <View style={{ marginTop: 10, gap: 6 }}>
          {body ? (
            <Txt variant="body" color="text" numberOfLines={3}>
              {body}
            </Txt>
          ) : null}
          {media.length > 0 && (
            <View style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', aspectRatio: 1 }}>
              <View style={{ width: '100%', height: '100%', backgroundColor: colors.card }} />
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
          <Pressable accessibilityLabel="Like" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="heart-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable accessibilityLabel="Comment" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable accessibilityLabel="Share" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="share-social-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityLabel="More" hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="ellipsis-vertical-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

/** Reusable setting row with chevron. */
function SettingsRow({ label, hint, icon, onPress }: { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; }) {
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

/** Card section wrapper. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: space.sm }}>
      <View style={{ padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Txt variant="label" color="textSecondary">
          {title}
        </Txt>
      </View>
      <View style={{ padding: space.md }}>{children}</View>
    </View>
  );
}
