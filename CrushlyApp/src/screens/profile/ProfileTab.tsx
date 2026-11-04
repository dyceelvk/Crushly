import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { SpaceScreen } from './UserProfile';

/**
 * Your Space — the same page everybody else sees.
 *
 * This used to be a second design: a cover with the name printed on it, a
 * gallery rail, a completion bar and a column of rows, none of which a visitor
 * ever saw. The brief was one layout, so this file is now a wrapper and the page
 * lives in `SpaceScreen`, where `mine` is the only difference between your own
 * Space and somebody else's.
 *
 * What that costs is nothing that was only ever decoration, and what it buys is
 * the thing that was actually missing: you can see your own Space as it is seen,
 * and every owner-only control — Edit, the gear, Your Circles, Your Moments,
 * Picked, Settings — sits on top of that page rather than beside it.
 */
export function ProfileTabScreen() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SpaceScreen mine />
    </View>
  );
}
