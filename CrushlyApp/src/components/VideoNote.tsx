import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, View } from 'react-native';
import { unstable_createElement } from 'react-native-web';
import * as ImagePicker from 'expo-image-picker';
import { Txt } from './Txt';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

const MAX_SECONDS = 60;

export type VideoNoteResult = { uri: string; duration: number; mimeType: string };

/**
 * Video note recorder for the web: getUserMedia + MediaRecorder in a modal —
 * live preview, record/stop, playback, then send. Native uses the device
 * camera app via expo-image-picker (mediaTypes: videos), see useVideoNote.
 */
export function VideoNoteRecorder({
  visible,
  onDone,
  onClose,
}: {
  visible: boolean;
  onDone: (note: VideoNoteResult) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setRecording(false);
    setElapsed(0);
    setPreview(null);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = true;
          await v.play().catch(() => {});
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) setError('Camera and microphone are needed for video notes. Allow them in your browser, or send a photo instead.');
      }
    })();
    return () => {
      cancelled = true;
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [visible]);

  // Elapsed ticker + hard stop at MAX_SECONDS.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(secs);
      if (secs >= MAX_SECONDS) stop(true);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const start = () => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: pickMime() });
    } catch {
      rec = new MediaRecorder(stream);
    }
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' });
      setPreview(URL.createObjectURL(blob));
    };
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    setElapsed(0);
    rec.start();
    setRecording(true);
  };

  const stop = (auto = false) => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
    if (auto) setElapsed(MAX_SECONDS);
  };

  const send = () => {
    const rec = recorderRef.current;
    if (!rec || !preview) return;
    const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' });
    onDone({ uri: URL.createObjectURL(blob), duration: Math.max(1, elapsed), mimeType: blob.type || 'video/webm' });
  };

  if (Platform.OS !== 'web' || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <View style={{ width: '100%', maxWidth: 360, alignItems: 'center', gap: space.md }}>
          <Txt variant="heading" color="#fff">
            Record a video note
          </Txt>
          <View style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: colors.goldLine }}>
            {unstable_createElement('video', {
              ref: videoRef,
              autoPlay: true,
              playsInline: true,
              muted: true,
              style: { width: '100%', height: '100%', objectFit: 'cover' },
            })}
            {preview ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }}>
                {unstable_createElement('video', {
                  src: preview,
                  controls: true,
                  playsInline: true,
                  style: { width: '100%', height: '100%', objectFit: 'cover' },
                })}
              </View>
            ) : null}
            {recording ? (
              <View style={{ position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D67' }} />
                <Txt variant="smallStrong" color="#fff">
                  {elapsed}s / {MAX_SECONDS}s
                </Txt>
              </View>
            ) : null}
          </View>
          {error ? (
            <Txt variant="small" color="#FF8FA3" align="center">
              {error}
            </Txt>
          ) : null}
          {preview ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Retake" variant="ghost" icon="refresh" onPress={() => setPreview(null)} />
              <Button title="Send video note" icon="send" onPress={send} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Cancel" variant="ghost" onPress={onClose} />
              {recording ? (
                <Button title={`Stop (${elapsed}s)`} icon="stop" variant="crush" onPress={() => stop()} />
              ) : (
                <Button
                  title={ready ? 'Start recording' : 'Starting camera…'}
                  icon="videocam-outline"
                  onPress={start}
                  disabled={!ready}
                  loading={!ready}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

/**
 * One call site for "record a video note": the recorder sheet on web, the
 * device camera app (videos) on native. Render `node` once in the screen.
 */
export function useVideoNote() {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((note: VideoNoteResult | null) => void) | null>(null);

  const record = useCallback(async (): Promise<VideoNoteResult | null> => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        throw new Error('Camera access is off. You can turn it on in your device settings.');
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_SECONDS, quality: 0.7 });
      if (result.canceled || !result.assets?.length) return null;
      const asset = result.assets[0];
      return {
        uri: asset.uri,
        duration: Math.round((asset.duration ?? 0) / 1000),
        mimeType: asset.mimeType || 'video/mp4',
      };
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, []);

  const node =
    Platform.OS === 'web' ? (
      <VideoNoteRecorder
        visible={visible}
        onDone={(note) => {
          setVisible(false);
          resolver.current?.(note);
          resolver.current = null;
        }}
        onClose={() => {
          setVisible(false);
          resolver.current?.(null);
          resolver.current = null;
        }}
      />
    ) : null;

  return { record, node };
}
