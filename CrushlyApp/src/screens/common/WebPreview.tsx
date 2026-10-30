import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/States';
import { AppWebView } from '../../components/WebView';
import { isSafeWebUrl } from '../../components/LinkText';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { ScreenProps } from '../../navigation/types';

function hostOf(raw: string): string {
  try {
    return new URL(raw).host.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

/**
 * A link, opened inside Crushly.
 *
 * Nothing in this app navigates outwards on its own. A member taps a link that
 * somebody put in a Flow, a Vibe or a Moment and it opens here — in our own
 * sheet, on Chromium where Chromium is what the platform runs — with the site's
 * name stated at the top the whole time. Leaving the app is a separate button,
 * pressed on purpose.
 *
 * Two things are deliberately honest. We say that we have not checked the page,
 * because we have not. And we show the address rather than a title, because a
 * page can call itself anything, while a hostname cannot.
 */
export function WebPreviewScreen({ route, navigation }: ScreenProps<'WebPreview'>) {
  const { url } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(url);
  const [failed, setFailed] = useState(false);

  if (!isSafeWebUrl(url)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.xl, paddingHorizontal: space.lg }}>
        <EmptyState
          icon="warning-outline"
          title="That link can’t be opened"
          message="Only web addresses — http and https — can be previewed."
          action={{ label: 'Close', onPress: () => navigation.goBack() }}
        />
      </View>
    );
  }

  const openExternal = () => {
    Linking.openURL(current).catch(() => undefined);
  };

  const engineNote =
    Platform.OS === 'android'
      ? 'Shown with Chromium inside Crushly. We haven’t checked this page — it isn’t ours.'
      : Platform.OS === 'web'
        ? 'Shown inside Crushly, in your browser. We haven’t checked this page — it isn’t ours.'
        : 'Shown inside Crushly. We haven’t checked this page — it isn’t ours.';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.md,
          paddingBottom: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <IconButton icon="close" label="Close preview" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="caption" color="textSecondary" numberOfLines={1}>
            Inside Crushly
          </Txt>
          <Txt variant="smallStrong" numberOfLines={1}>
            {hostOf(current)}
          </Txt>
        </View>
        <IconButton icon="open-outline" label="Open in your browser" onPress={openExternal} />
      </View>

      {loading ? (
        <View style={{ paddingVertical: 6, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      ) : null}

      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {Platform.OS === 'web' && failed ? (
          <EmptyState
            icon="close-circle-outline"
            title="This site won’t let itself be previewed"
            message="Some sites refuse to be shown inside another page. You can still open it in a browser tab."
            action={{ label: 'Open in a new tab', onPress: openExternal }}
          />
        ) : (
          <AppWebView uri={url} onLoadingChange={setLoading} onUrlChange={setCurrent} onError={() => setFailed(true)} />
        )}
      </View>

      <View
        style={{
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
          <Txt variant="caption" color="textMuted" style={{ flex: 1 }}>
            {engineNote}
          </Txt>
        </View>
        <Button
          title="Continue to this site in your browser"
          variant="secondary"
          size="md"
          onPress={openExternal}
          icon="open-outline"
        />
      </View>
    </View>
  );
}
