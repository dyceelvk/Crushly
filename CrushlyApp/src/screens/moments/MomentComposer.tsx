import React, { useState } from 'react';
import { Pressable, TextInput, View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Header, useLayout } from '../../components/Layout';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Photo } from '../../components/Photo';
import { IconButton } from '../../components/IconButton';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { api, appendFile } from '../../api/client';
import { keys } from '../../api/hooks';
import type { MomentStyle } from '../../api/types';
import { MOMENT_STYLES } from '../../lib/catalog';
import { pickImage, type PickedImage } from '../../lib/media';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, radius, space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

export function MomentComposerScreen({ navigation }: ScreenProps<'MomentComposer'>) {
  const { colors } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'text' | 'photo'>('text');
  const [body, setBody] = useState('');
  const [style, setStyle] = useState<MomentStyle>('champagne');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [audience, setAudience] = useState<'everyone' | 'connections'>('everyone');
  const [busy, setBusy] = useState(false);

  const w = Math.min(contentWidth - gutter * 2, 360);
  const h = w * 1.4;
  const s = MOMENT_STYLES[style];
  const max = mode === 'text' ? 280 : 200;
  const ready = mode === 'text' ? body.trim().length > 0 : !!photo;

  const choosePhoto = async (camera = false) => {
    const img = await pickImage({ camera });
    if (!img) return;
    if ('error' in img) return toast({ kind: 'error', title: 'Photo not added', message: img.error });
    setPhoto(img);
    setMode('photo');
  };

  const share = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('body', body.trim());
      form.append('style', style);
      form.append('audience', audience);
      if (mode === 'photo' && photo) await appendFile(form, 'photo', photo.uri, 'moment.jpg', photo.mimeType);
      await api.upload('/moments', form);
      qc.invalidateQueries({ queryKey: keys.moments });
      toast({ kind: 'success', title: 'Your Moment is live', message: 'It’ll disappear in 24 hours.' });
      navigation.goBack();
    } catch (e) {
      toast({ kind: 'error', title: 'Moment not shared', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboard footer={<Button title="Share Moment" onPress={share} disabled={!ready} loading={busy} />}>
      <Header title="New Moment" subtitle="Share a glimpse. Gone in 24 hours." right={<IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />} />

      <Segmented<'text' | 'photo'>
        value={mode}
        onChange={(m) => (m === 'photo' && !photo ? choosePhoto() : setMode(m))}
        options={[
          { value: 'text', label: 'Words' },
          { value: 'photo', label: 'Photo' },
        ]}
      />

      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <View style={{ width: w, height: h, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.card }}>
          {mode === 'photo' && photo ? (
            <>
              <Photo uri={photo.uri} style={{ width: w, height: h }} contentPosition="center" alt="Selected photo" />
              <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 }}>
                <IconButton icon="images-outline" variant="glass" label="Choose another photo" onPress={() => choosePhoto()} />
                {Platform.OS !== 'web' ? <IconButton icon="camera-outline" variant="glass" label="Take a photo" onPress={() => choosePhoto(true)} /> : null}
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <TextInput
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
                value={body}
                onChangeText={setBody}
                placeholder="What’s the moment?"
                placeholderTextColor={s.ink + '88'}
                maxLength={max}
                multiline
                autoFocus={Platform.OS !== 'web'}
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
