import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import type { PostSound } from '../api/types';
import type { RootStackParamList } from '../navigation/types';

/**
 * The little spinning record at the bottom-right of a clip — the door to the
 * sound it is under. It turns while the clip plays and rests when it pauses,
 * the way a record does.
 */
export function SoundDisc({
  sound,
  playing = true,
  size = 46,
  bottom = 12,
  right = 12,
}: {
  sound: PostSound | null | undefined;
  playing?: boolean;
  size?: number;
  bottom?: number;
  right?: number;
}) {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const spin = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (playing) {
      spin.setValue(0);
      const loop = Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 3800, easing: Easing.linear, useNativeDriver: true }),
      );
      running.current = loop;
      loop.start();
      return () => {
        loop.stop();
        running.current = null;
      };
    }
    running.current?.stop();
    running.current = null;
    return;
  }, [playing, spin]);

  if (!sound) return null;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Pressable
      onPress={(event) => {
        // The disc lives inside bigger tap surfaces (the clip card opens the
        // post): tapping the record must open the sound, never the post.
        event.stopPropagation?.();
        navigation.navigate('Sound', { soundId: sound.id });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open sound: ${sound.title}`}
      hitSlop={8}
      style={{ position: 'absolute', bottom, right, width: size, height: size, zIndex: 30 }}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ rotate }],
          backgroundColor: colors.elevated,
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.85)',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {sound.ownerAvatar ? (
          <Image source={{ uri: sound.ownerAvatar }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
            <Ionicons name="musical-notes" size={size * 0.38} color="#FFFFFF" />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}
