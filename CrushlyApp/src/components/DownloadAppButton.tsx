import React from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { Button, type ButtonVariant } from './Button';
import { useToast } from './Toast';
import { useAppUpdate } from '../api/hooks';

/**
 * The Android file, offered to somebody using the web build.
 *
 * The web build is the shop window: a member can read a Space, write a Crush,
 * watch a Moment — and then has no way to put the thing on their phone, because
 * the download only ever lived inside the Android app they do not have yet.
 * This is that door, and it opens the same file the in-app updater opens, so
 * there is one build of Holup for Android and not two.
 *
 * When no file is published the button says so instead of doing nothing: a
 * download control that silently does nothing is a lie about the product.
 */
export function DownloadAppButton({
  label = 'Download app',
  size = 'sm',
  variant = 'ghost',
}: {
  label?: string;
  size?: 'md' | 'lg' | 'sm';
  variant?: ButtonVariant;
}) {
  const versionCode = Number(Constants.expoConfig?.android?.versionCode ?? 0);
  const { data, isFetching } = useAppUpdate(versionCode);
  const toast = useToast();

  const open = () => {
    const url = data?.apkUrl;
    if (!url) {
      toast({
        kind: 'info',
        title: 'No build published yet',
        message: isFetching
          ? 'Still asking the update server. Try again in a moment.'
          : 'Holup for Android isn’t on the update server yet.',
      });
      return;
    }
    Linking.openURL(url).catch((e: Error) =>
      toast({ kind: 'error', title: 'Couldn’t open the download', message: e.message }),
    );
  };

  // Only the web build needs this: on Android the app is already installed, and
  // on iOS an APK is not a file that phone can use.
  if (Platform.OS !== 'web') return null;

  return (
    <Button
      title={label}
      size={size}
      variant={variant}
      icon="download-outline"
      onPress={open}
      full={false}
      accessibilityLabel="Download the Holup app for Android"
      accessibilityHint="Opens the latest Holup APK"
    />
  );
}
