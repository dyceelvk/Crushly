import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Header } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Photo } from '../../components/Photo';
import { EditedClip } from '../../components/EditedClip';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { mediaUrl } from '../../api/client';
import { mediaSource } from '../../lib/mediaHost';
import { sharePostToMoment } from '../../api/service';
import type { RootStackParamList } from '../../navigation/types';

const EMOJIS = ['🔥', '😂', '❤️', '😭', '✨', '😍', '💀', '🎉', '👀', '🥹', '💯', '🤌'];

type Sticker = { id: number; char: string; x: number; y: number };

/**
 * Share to Moments, with a look before it goes.
 *
 * The old tap shared instantly: the post was in your Moments before you had
 * seen what the card would say. This is the pause before the send — the video
 * or post previewed full-size, with the tools a person actually reaches for:
 * words over the picture, and emoji stickers on it. Whatever is written here
 * becomes the Moment's words; the Moment still points at the original post, so
 * access rules travel with it and nothing is copied.
 */
export function ShareToMomentScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShareToMoment'>>();
  const { postId, mediaUrl: rawMedia, mediaKind, body: postBody, authorName } = route.params;

  const [text, setText] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [busy, setBusy] = useState(false);

  const isVideo = mediaKind === 'video' && !!rawMedia;
  const src = useMemo(() => (rawMedia ? mediaSource(mediaUrl(rawMedia)) : null), [rawMedia]);

  /* Stickers land on a loose spiral so two taps never stack on the same pixel. */
  const addSticker = (char: string) => {
    setStickers((current) => [
      ...current,
      {
        id: Date.now() + current.length,
        char,
        x: 8 + ((current.length * 34) % 120),
        y: 8 + ((current.length * 42) % 150),
      },
    ]);
  };

  const composed = [stickers.map((s) => s.char).join(''), text.trim()].filter(Boolean).join(text.trim() && stickers.length ? ' ' : '');

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sharePostToMoment(postId, { body: composed });
      toast({ kind: 'success', title: 'In your Moment', message: 'A preview of the post, with your words on it.' });
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Couldn’t share it', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll keyboard contentStyle={{ paddingBottom: space.lg }}>
      <Header title="Share to Moment" subtitle="See it first — then add your words" back />

      {/* ------------------------------------------------------- the preview */}
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0B070C', height: 380 }}>
        {src && isVideo ? (
          <EditedClip uri={src} live={null} autoPlay loop muted controls={false} style={{ width: '100%', height: '100%' }} accessibilityLabel={`Preview of ${authorName}’s video`} />
        ) : src ? (
          <Photo uri={rawMedia!} fit="cover" style={{ width: '100%', height: '100%' }} alt={`Preview of ${authorName}’s post`} />
        ) : (
          <View style={{ flex: 1, padding: space.lg, justifyContent: 'center' }}>
            <Txt variant="title" color="#FFFFFF" numberOfLines={8}>
              {postBody || 'A post'}
            </Txt>
          </View>
        )}

        {/* The emoji stickers. Tap one to take it off. */}
        {stickers.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setStickers((current) => current.filter((x) => x.id !== s.id))}
            accessibilityRole="button"
            accessibilityLabel={`Remove emoji ${s.char}`}
            style={{ position: 'absolute', left: s.x, top: s.y }}
          >
            <Txt style={{ fontSize: 34 }}>{s.char}</Txt>
          </Pressable>
        ))}

        {/* The words over the picture. */}
        {text.trim() ? (
          <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(8,8,12,0.66)', borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12 }}>
              <Txt variant="body" color="#FFFFFF">
                {text}
              </Txt>
            </View>
            <Pressable
              onPress={() => {
                setText('');
                setTextOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove the text"
              style={{ marginLeft: 8, padding: 6 }}
            >
              <Ionicons name="close-circle" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* ------------------------------------------------------------ tools */}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Button
          title="Add text"
          icon="text-outline"
          variant={textOpen ? 'primary' : 'secondary'}
          onPress={() => setTextOpen((v) => !v)}
          style={{ flex: 1 }}
        />
        <Button title="Add emoji" icon="happy-outline" variant="secondary" onPress={() => addSticker(EMOJIS[stickers.length % EMOJIS.length])} style={{ flex: 1 }} />
      </View>

      {textOpen ? (
        <View style={{ marginTop: space.sm }}>
          <Input
            label="Your words"
            value={text}
            onChangeText={setText}
            placeholder="Say something about this…"
            multiline
            maxLength={200}
            showCount
            autoFocus
          />
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.sm }} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
        {EMOJIS.map((e) => (
          <Pressable
            key={e}
            onPress={() => addSticker(e)}
            accessibilityRole="button"
            accessibilityLabel={`Add emoji ${e}`}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated }}
          >
            <Txt style={{ fontSize: 20 }}>{e}</Txt>
          </Pressable>
        ))}
      </ScrollView>

      <Txt variant="caption" color="textMuted" style={{ marginTop: space.sm }}>
        Tap an emoji on the preview to remove it. Your words travel with the Moment; the post itself is never copied.
      </Txt>

      <Button
        title={busy ? 'Sharing…' : 'Share to Moment'}
        icon="add-circle-outline"
        loading={busy}
        onPress={() => {
          void share();
        }}
        style={{ marginTop: space.md }}
      />
    </Screen>
  );
}
