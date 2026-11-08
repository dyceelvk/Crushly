import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { IconButton } from '../../components/IconButton';
import { DiscoverPane } from './Discover';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Discover, as a destination in its own right.
 *
 * Discover used to be a segment of Home. That made the strip carry two
 * different kinds of thing — parts of the feed, and a list of people you have
 * not met — and it made search a magnifier bolted to the end of a row that was
 * about something else. So Discover moved to the bar, and the magnifier moved
 * with it: searching is what you do here, not what the Home strip does.
 *
 * The strip on Home keeps the three things that *are* the feed: Flow, Crushes,
 * Connections.
 */
export function DiscoverTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  // The title is the page's own ink. It used to be a hard-coded white, which is
  // invisible on the white page the light appearance gives you — a blank band
  // with a search icon stranded on it, which is exactly what was reported.
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: insets.top + space.sm,
            paddingHorizontal: 16,
            paddingBottom: space.sm,
          }}
        >
          <Txt variant="display" accessibilityRole="header" style={{ color: colors.text }}>
            Discover
          </Txt>
          <IconButton icon="search" label="Search Holup" onPress={() => navigation.navigate('Search')} />
        </View>
      <DiscoverPane />
    </View>
  );
}
