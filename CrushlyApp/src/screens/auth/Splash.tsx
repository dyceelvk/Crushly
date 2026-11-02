import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Glow } from '../../components/Ambient';
import { palettes } from '../../theme/tokens';

/**
 * The canvas behind a session restore.
 *
 * This used to be a logo screen — mark, wordmark, tagline, a light sweep. It was
 * removed on purpose: it was the first frame of the product and it said nothing,
 * so every launch began with a screen you had to wait out. What is left is the
 * brand's own light on the brand's own black, held only for as long as the stored
 * session takes to come back, and then the app is either on the feed (returning
 * member) or on "Follow the feelings" (first launch).
 *
 * Deliberately no text and no animation: this is not a screen, it is a breath.
 */
export function BootCanvas() {
  const c = palettes.dark;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, overflow: 'hidden' }]}>
      <Glow size={520} color={c.primary} opacity={0.45} style={{ position: 'absolute', top: -260, left: -200 }} />
      <Glow size={520} color={c.crush} opacity={0.3} style={{ position: 'absolute', bottom: -280, right: -220 }} />
    </View>
  );
}
