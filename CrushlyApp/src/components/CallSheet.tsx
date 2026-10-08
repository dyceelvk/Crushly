import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from './Txt';
import { Button } from './Button';
import { Avatar } from './Photo';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import type { CallState } from '../lib/call';
import { durationLabel } from '../lib/format';

/**
 * Voice-call UI: outgoing ring, incoming accept/decline, in-call controls.
 * Web only — the Chat screen gates the call button with an honest message on
 * native (React Native has no WebRTC without a native module).
 */
export function CallSheet({
  visible,
  state,
  peerName,
  peerPhoto,
  muted,
  onAccept,
  onDecline,
  onHangup,
  onToggleMute,
}: {
  visible: boolean;
  state: CallState;
  peerName: string;
  peerPhoto?: string | null;
  muted: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
}) {
  const { colors } = useTheme();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== 'active') {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  if (!visible) return null;

  const title =
    state === 'incoming' ? `${peerName} is calling` : state === 'outgoing' ? `Calling ${peerName}…` : peerName;
  const subtitle =
    state === 'incoming' ? 'Voice call' : state === 'outgoing' ? 'Ringing…' : durationLabel(elapsed);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,8,6,0.94)', alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <View style={{ alignItems: 'center', gap: space.md, width: '100%', maxWidth: 340 }}>
          <Avatar uri={peerPhoto} name={peerName} size={96} ring="gold" />
          <Txt variant="heading" color="#fff" align="center">
            {title}
          </Txt>
          <Txt variant="body" color="rgba(255,255,255,0.7)" align="center">
            {subtitle}
          </Txt>

          {state === 'incoming' ? (
            <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.lg }}>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Button title="Decline" variant="ghost" icon="call" onPress={onDecline} />
              </View>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Button title="Accept" icon="call" onPress={onAccept} />
              </View>
            </View>
          ) : state === 'outgoing' ? (
            <View style={{ marginTop: space.lg }}>
              <Button title="Cancel" variant="ghost" icon="call" onPress={onHangup} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.lg, alignItems: 'center' }}>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Button
                  title={muted ? 'Unmute' : 'Mute'}
                  variant="ghost"
                  icon={muted ? 'mic-off' : 'mic'}
                  onPress={onToggleMute}
                />
              </View>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Button title="Hang up" variant="crush" icon="call" onPress={onHangup} />
              </View>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm }}>
            <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.5)" />
            <Txt variant="caption" color="rgba(255,255,255,0.5)">
              End-to-end encrypted, peer-to-peer
            </Txt>
          </View>
        </View>
      </View>
    </Modal>
  );
}
