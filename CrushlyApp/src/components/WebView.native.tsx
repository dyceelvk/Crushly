import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { AppWebViewProps } from './WebView';

/**
 * Android and iOS: the real thing.
 *
 * On Android this is Chromium — the system WebView — so a link opens inside
 * Crushly with a proper browser engine and never hands the member to another
 * app. On iOS it is WebKit, because Apple allows no other engine on the
 * platform; the behaviour is the same from the member's side.
 *
 * We never let a page run whatever it likes: JavaScript is on because most of
 * the web is broken without it, but file access, universal links into other
 * apps and third-party cookies are off, and navigation is reported back so the
 * sheet can always show which site the member is actually looking at.
 */
export function AppWebView({ uri, style, onLoadingChange, onUrlChange, onError }: AppWebViewProps) {
  return (
    <WebView
      source={{ uri }}
      style={[{ flex: 1, backgroundColor: '#fff' }, style]}
      onLoadStart={() => onLoadingChange?.(true)}
      onLoadEnd={() => onLoadingChange?.(false)}
      onError={() => {
        onLoadingChange?.(false);
        onError?.();
      }}
      onNavigationStateChange={(e) => onUrlChange?.(e.url)}
      // Deliberate: pages are sandboxed to the page, not to the device.
      javaScriptEnabled
      allowFileAccess={false}
      allowUniversalAccessFromFileURLs={false}
      thirdPartyCookiesEnabled={false}
      // A page that wants to open another app must not do it silently.
      setSupportMultipleWindows={false}
      originWhitelist={['http://*', 'https://*']}
    />
  );
}
