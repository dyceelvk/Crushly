import React, { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter, Modal, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { Txt } from './Txt';
import { Button } from './Button';
import { useAppUpdate } from '../api/hooks';
import { useAuth } from '../state/auth';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { downloadUpdate, installUpdate, readableSize, resolveUpdateDownload } from '../lib/updates';

/**
 * "Update available" — and then actually doing it.
 *
 * A member who is handed an APK has no store to nag them, so the app has to be
 * the one that says a newer build exists. This asks the update endpoint once per
 * launch, and when the number on the server is higher than the number in this
 * build it offers the update in the app's own voice, once, without blocking the
 * feed behind it.
 *
 * The steps are the honest ones:
 *
 *   offer → downloading → Android installer → unconfirmed
 *
 * Returning from Android's installer does not prove it installed anything.
 * A successful replacement normally closes this process; if it returns here,
 * the currently running app must not claim success.
 */
export function UpdateGate() {
  // The check, the download and the installer are all Android-only; the web
  // build gets its download button in Settings instead.
  //
  // This used to bail out for the signed release identity (app.holup.mobile),
  // because the only channel then was the debug one and offering a differently
  // signed APK is worse than offering nothing. The Worker now serves this
  // identity's own build on the secure channel, so the reason to stay silent is
  // gone — and staying silent is why phones sat on old versions.
  if (Platform.OS !== 'android') return null;
  return <AndroidUpdateGate />;
}

const OPEN_UPDATE = 'holup.open-update';

/** Reopen the in-app update offer after it was dismissed. */
export function requestHolupUpdate(): void {
  if (Platform.OS === 'android') DeviceEventEmitter.emit(OPEN_UPDATE);
}

type Step = 'hidden' | 'offer' | 'downloading' | 'installing' | 'unconfirmed' | 'error';

function AndroidUpdateGate() {
  const { colors } = useTheme();
  const { me } = useAuth();
  const versionCode = Number(Constants.expoConfig?.android?.versionCode ?? 0);
  const update = useAppUpdate(versionCode);

  const [step, setStep] = useState<Step>('hidden');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [putOff, setPutOff] = useState(false);

  const available = !!update.data?.available && !!update.data?.apkUrl;
  const required = !!update.data?.required;

  useEffect(() => {
    if (step !== 'hidden' || putOff) return;
    if (available) setStep('offer');
  }, [available, step, putOff]);

  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(OPEN_UPDATE, () => {
      if (!available) return;
      setPutOff(false);
      setStep((current) => current === 'hidden' ? 'offer' : current);
    });
    return () => listener.remove();
  }, [available]);

  const run = useCallback(async () => {
    const infoUrl = update.data?.downloadInfoUrl;
    if (!infoUrl) {
      setMessage('The verified Android download is not ready yet. Please try again shortly.');
      setStep('error');
      return;
    }
    setStep('downloading');
    setProgress(0);
    try {
      const url = await resolveUpdateDownload(infoUrl);
      const file = await downloadUpdate(url, setProgress, update.data?.bytes);
      setStep('installing');
      await installUpdate(file);
      // Returning from the installer may mean cancellation or a parser error.
      // A successful replacement normally terminates the old app process.
      setStep('unconfirmed');
    } catch (e) {
      setMessage((e as Error).message || 'The update could not be downloaded.');
      setStep('error');
    }
  }, [update.data?.downloadInfoUrl, update.data?.bytes]);

  const dismiss = useCallback(() => {
    setPutOff(true);
    setStep('hidden');
  }, []);

  if (step === 'hidden') return null;

  const version = update.data?.version ? ` ${update.data.version}` : '';
  const size = readableSize(update.data?.bytes);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={required || step === 'downloading' || step === 'installing' ? undefined : dismiss}>
      <View style={{ flex: 1, backgroundColor: 'rgba(7,7,8,0.72)', justifyContent: 'center', padding: space.lg }}>
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: space.lg,
            gap: space.sm,
          }}
        >
          {step === 'offer' ? (
            <>
              <Txt variant="title" color="text">Update available!</Txt>
              <Txt variant="body" color="textSecondary">
                Hello {me?.profile?.name ?? 'there'} — holUpp has a new update{version}. Update now to enjoy the new features.
              </Txt>
              <Txt variant="caption" color="textMuted">
                {size ? `${size} · ` : ''}Android installs it over your current version. Save any unfinished work first.
              </Txt>
              <View style={{ height: space.sm }} />
              <Button title="Update now" icon="cloud-download-outline" onPress={run} />
              {required ? null : (
                <Button title="Later" variant="ghost" size="md" onPress={dismiss} />
              )}
            </>
          ) : null}

          {step === 'downloading' ? (
            <>
              <Txt variant="title" color="text">Downloading the update…</Txt>
              <Txt variant="body" color="textSecondary">
                {Math.round(progress * 100)}%{size ? ` of ${size}` : ''}. Keep holUpp open until it finishes.
              </Txt>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.elevated, overflow: 'hidden', marginTop: space.sm }}>
                <View style={{ width: `${Math.max(2, Math.round(progress * 100))}%`, height: 8, backgroundColor: colors.crush }} />
              </View>
            </>
          ) : null}

          {step === 'installing' ? (
            <>
              <Txt variant="title" color="text">Almost done</Txt>
              <Txt variant="body" color="textSecondary">
                Android will ask whether to update holUpp. Tap Install — the download is already on this phone.
              </Txt>
            </>
          ) : null}

          {step === 'unconfirmed' ? (
            <>
              <Txt variant="title" color="text">Update not confirmed</Txt>
              <Txt variant="body" color="textSecondary">
                Android did not confirm that the update was installed. Your current version is still running. You can try again or check the version in Settings.
              </Txt>
              <View style={{ height: space.sm }} />
              <Button title="Try again" icon="refresh" onPress={run} />
              {required ? null : <Button title="Later" variant="ghost" size="md" onPress={dismiss} />}
            </>
          ) : null}

          {step === 'error' ? (
            <>
              <Txt variant="title" color="text">The update didn’t finish</Txt>
              <Txt variant="body" color="textSecondary">{message}</Txt>
              <View style={{ height: space.sm }} />
              <Button title="Try again" onPress={run} />
              {required ? null : <Button title="Later" variant="ghost" size="md" onPress={dismiss} />}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
