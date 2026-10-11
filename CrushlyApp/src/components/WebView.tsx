import React from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export type AppWebViewProps = {
  uri: string;
  style?: StyleProp<ViewStyle>;
  onLoadingChange?: (loading: boolean) => void;
  onUrlChange?: (url: string) => void;
  onError?: () => void;
};

/**
 * Web: keep the page inside Crushly with an iframe.
 *
 * On the web we cannot ship our own engine — the browser a member is already
 * using is the engine — so this is the honest version of "inside the app":
 * the page is framed here rather than the app navigating away. Some sites
 * refuse to be framed, and when that happens the sheet says so and offers to
 * open a tab instead, which is still a choice the member makes.
 */
export function AppWebView({ uri, style, onLoadingChange, onUrlChange, onError }: AppWebViewProps) {
  React.useEffect(() => {
    onLoadingChange?.(true);
    onUrlChange?.(uri);
  }, [uri, onLoadingChange, onUrlChange]);

  return (
    <View style={[{ flex: 1, backgroundColor: '#fff' }, style]}>
      {React.createElement('iframe', {
        key: uri,
        src: uri,
        title: 'Link preview',
        // A framed page must not be able to touch our app.
        sandbox: 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
        referrerPolicy: 'no-referrer',
        style: { width: '100%', height: '100%', border: '0', backgroundColor: '#fff' },
        onLoad: () => onLoadingChange?.(false),
        onError: () => {
          onLoadingChange?.(false);
          onError?.();
        },
      })}
    </View>
  );
}
