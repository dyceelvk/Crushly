import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, View } from 'react-native';
import { browserElement } from '../lib/browserElement';
import { Txt } from './Txt';
import { Button } from './Button';
import { pickImage, type PickedImage } from '../lib/media';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

const MAX_EDGE = 1440;

/**
 * Live camera capture for the web: a getUserMedia preview (front camera) with
 * a snap button. expo-image-picker's camera is not supported on web, which is
 * why `pickImage({ camera: true })` used to fall back to the gallery there.
 * The captured frame is cropped/resized in a canvas and returned as a data URL,
 * which the upload path already handles (uriToBlob fetches data: URLs).
 *
 * Native keeps using expo-image-picker's camera — see useLiveCamera below.
 */
export function CameraCapture({
  visible,
  square = false,
  onCapture,
  onClose,
}: {
  visible: boolean;
  square?: boolean;
  onCapture: (img: PickedImage) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setSnap(null);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) {
          setError('Camera access is off or unavailable. Allow the camera in your browser — or upload a photo instead.');
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [visible]);

  const snapPhoto = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    // Center-crop to a square when asked (verification selfies), else full frame.
    const side = square ? Math.min(vw, vh) : vw;
    const sx = square ? (vw - side) / 2 : 0;
    const sy = square ? (vh - side) / 2 : 0;
    const scale = Math.min(1, MAX_EDGE / side);
    const w = Math.max(1, Math.round(side * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = w;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, sx, sy, side, side, 0, 0, w, w);
    setSnap(canvas.toDataURL('image/jpeg', 0.9));
  }, [square]);

  if (Platform.OS !== 'web' || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <View style={{ width: '100%', maxWidth: 360, alignItems: 'center', gap: space.md }}>
          <Txt variant="heading" color="#fff">
            Take a live selfie
          </Txt>
          <View style={{ width: '100%', aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: colors.goldLine }}>
            {/* The video stays mounted even while reviewing the snap, so the
                stream survives a retake without reopening the camera. */}
            {browserElement('video', {
              ref: videoRef,
              autoPlay: true,
              playsInline: true,
              muted: true,
              style: { width: '100%', height: '100%', objectFit: 'cover' },
            })}
            {snap ? (
              <Image source={{ uri: snap }} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel="Your captured photo" />
            ) : null}
          </View>
          {error ? (
            <Txt variant="small" color="#FF8FA3" align="center">
              {error}
            </Txt>
          ) : null}
          {snap ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Retake" variant="ghost" icon="refresh" onPress={() => setSnap(null)} />
              <Button title="Use this photo" icon="checkmark" onPress={() => onCapture({ uri: snap, mimeType: 'image/jpeg' })} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Cancel" variant="ghost" onPress={onClose} />
              <Button
                title={ready ? 'Snap' : 'Starting camera…'}
                icon="camera-outline"
                onPress={snapPhoto}
                disabled={!ready}
                loading={!ready}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * One call site for "snap a live picture": opens the CameraCapture sheet on
 * web, or expo-image-picker's camera on native. Resolves with the captured
 * image (or null when cancelled, or { error } when the camera is unavailable).
 * Render `node` once in the screen so the sheet can appear.
 */
export function useLiveCamera({ square = false }: { square?: boolean } = {}) {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((img: PickedImage | { error: string } | null) => void) | null>(null);

  const capture = useCallback(async (): Promise<PickedImage | { error: string } | null> => {
    if (Platform.OS !== 'web') return pickImage({ camera: true, square });
    return new Promise((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, [square]);

  const node =
    Platform.OS === 'web' ? (
      <CameraCapture
        visible={visible}
        square={square}
        onCapture={(img) => {
          setVisible(false);
          resolver.current?.(img);
          resolver.current = null;
        }}
        onClose={() => {
          setVisible(false);
          resolver.current?.(null);
          resolver.current = null;
        }}
      />
    ) : null;

  return { capture, node };
}
