import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Photo as PhotoT } from '../api/types';
import { Photo } from './Photo';
import { PressableScale } from './PressableScale';
import { Txt } from './Txt';
import { ActionSheet } from './BottomSheet';
import { useToast } from './Toast';
import { useDeletePhoto, useReorderPhotos, useUploadPhoto } from '../api/hooks';
import { pickImage } from '../lib/media';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';

/**
 * Profile photo manager: one hero slot plus five supporting slots. Uploads
 * are real (resized client-side first); tap a photo to make it main or remove it.
 */
export function PhotoGrid({ photos, width }: { photos: PhotoT[]; width: number }) {
  const { colors } = useTheme();
  const toast = useToast();
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const reorder = useReorderPhotos();
  const [selected, setSelected] = useState<PhotoT | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  const gap = 10;
  const small = (width - gap * 2) / 3;
  const big = small * 2 + gap;

  const add = async (slot: number) => {
    const picked = await pickImage();
    if (!picked) return;
    if ('error' in picked) {
      toast({ kind: 'error', title: 'No photo added', message: picked.error });
      return;
    }
    setUploadingSlot(slot);
    try {
      await upload.mutateAsync(picked);
    } catch (e) {
      toast({ kind: 'error', title: 'Upload didn’t finish', message: (e as Error).message });
    } finally {
      setUploadingSlot(null);
    }
  };

  const slot = (i: number, w: number, h: number) => {
    const p = photos[i];
    const loading = uploadingSlot === i || (remove.isPending && remove.variables === p?.id);
    return (
      <PressableScale
        key={p ? `p${p.id}` : `e${i}`}
        onPress={() => (p ? setSelected(p) : add(i))}
        disabled={loading || (!p && i > photos.length)}
        accessibilityLabel={p ? `Photo ${i + 1}${i === 0 ? ', main photo' : ''}. Options` : `Add photo ${i + 1}`}
        pressedScale={0.97}
        style={{
          width: w, height: h, borderRadius: radius.lg, overflow: 'hidden',
          backgroundColor: colors.card, borderWidth: 1, borderColor: p ? colors.border : colors.borderStrong,
          borderStyle: p ? 'solid' : 'dashed', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {p ? <Photo uri={p.url} style={{ width: '100%', height: '100%' }} /> : (
          <View style={{ alignItems: 'center', gap: 6, opacity: i > photos.length ? 0.4 : 1 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color={colors.gold} />
            </View>
            {i === 0 ? (
              <Txt variant="caption" color="textSecondary">
                Main photo
              </Txt>
            ) : null}
          </View>
        )}
        {p && i === 0 ? (
          <View style={{ position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(7,7,8,0.65)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Txt variant="caption" color="#fff">
              Main
            </Txt>
          </View>
        ) : null}
        {loading ? (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(7,7,8,0.55)', alignItems: 'center', justifyContent: 'center' } as object}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : null}
      </PressableScale>
    );
  };

  const smallH = small * 1.25;
  return (
    <View>
      <View style={{ flexDirection: 'row', gap }}>
        {slot(0, big, smallH * 2 + gap)}
        <View style={{ gap }}>
          {slot(1, small, smallH)}
          {slot(2, small, smallH)}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap, marginTop: gap }}>
        {[3, 4, 5].map((i) => slot(i, small, smallH))}
      </View>
      <ActionSheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title="Photo"
        actions={[
          ...(selected && photos[0]?.id !== selected.id
            ? [{
                label: 'Make main photo',
                onPress: () => {
                  const ids = [selected.id, ...photos.filter((p) => p.id !== selected.id).map((p) => p.id)];
                  reorder.mutate(ids, { onError: (e) => toast({ kind: 'error', title: 'Couldn’t reorder', message: (e as Error).message }) });
                },
              }]
            : []),
          {
            label: 'Remove photo',
            destructive: true,
            onPress: () => {
              if (!selected) return;
              remove.mutate(selected.id, { onError: (e) => toast({ kind: 'error', title: 'Photo kept', message: (e as Error).message }) });
            },
          },
        ]}
      />
    </View>
  );
}
