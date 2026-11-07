import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Modal, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { Txt } from './Txt';
import { Button } from './Button';
import { useAppUpdate } from '../api/hooks';
import { useAuth } from '../state/auth';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { downloadUpdate, installUpdate, readableSize } from '../lib/updates';

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
 *   offer → downloading → installing → installed
 *
 * There is no "silent install" and no pretending the install is done: Android's
 * own installer sheet is the confirmation, and the last screen says plainly that
 * Crushly has to be opened again before the new version is the one running.
 */
export function UpdateGate() {
  // The check, the download and the installer are all Android-only; the web
  // build gets its download button in Settings instead.
  if (Platform.OS !== 'android') return null;
  return <AndroidUpdateGate />;
}

type Step = 'hidden' | 'offer' | 'downloading' | 'installing' | 'installed' | 'error';

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

  const run = useCallback(async () => {
    const url = update.data?.apkUrl;
    if (!url) return;
    setStep('downloading');
    setProgress(0);
    try {
      const file = await downloadUpdate(url, setProgress);
      setStep('installing');
      await installUpdate(file);
      // The installer sheet has been shown. Whether the member taps Install is
      // theirs to decide, and the phone tells us nothing either way — so the
      // last screen is worded for both answers.
      setStep('installed');
    } catch (e) {
      setMessage((e as Error).message || 'The update could not be downloaded.');
      setStep('error');
    }
  }, [update.data?.apkUrl]);

  /** Installing over a running app kills it; this is the only real "restart". */
  const restart = useCallback(() => {
    BackHandler.exitApp();
  }, []);

  if (step === 'hidden') return null;

  const version = update.data?.version ? ` ${update.data.version}` : '';
  const size = readableSize(update.data?.bytes);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={required ? undefined : () => setPutOff(true)}>
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
                Hello {me?.profile?.name ?? 'there'} — Crushly has a new update{version}. Update now to enjoy the new features.
              </Txt>
              <Txt variant="caption" color="textMuted">
                {size ? `${size} · ` : ''}It installs over the version you already have, so nothing is lost and no
                second copy is made.
              </Txt>
              <View style={{ height: space.sm }} />
              <Button title="Update now" icon="cloud-download-outline" onPress={run} />
              {required ? null : (
                <Button title="Later" variant="ghost" size="md" onPress={() => setPutOff(true)} />
              )}
            </>
          ) : null}

          {step === 'downloading' ? (
            <>
              <Txt variant="title" color="text">Downloading the update…</Txt>
              <Txt variant="body" color="textSecondary">
                {Math.round(progress * 100)}%{size ? ` of ${size}` : ''}. Keep Crushly open until it finishes.
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
                Android will ask whether to update Crushly. Tap Install — the download is already on this phone.
              </Txt>
            </>
          ) : null}

          {step === 'installed' ? (
            <>
              <Txt variant="title" color="text">Update installed</Txt>
              <Txt variant="body" color="textSecondary">
                Refresh Crushly before it takes the changes — the version running right now is still the old one.
              </Txt>
              <View style={{ height: space.sm }} />
              <Button title="Refresh" icon="refresh" onPress={restart} />
              <Button title="Not now" variant="ghost" size="md" onPress={() => setPutOff(true)} />
            </>
          ) : null}

          {step === 'error' ? (
            <>
              <Txt variant="title" color="text">The update didn’t finish</Txt>
              <Txt variant="body" color="textSecondary">{message}</Txt>
              <View style={{ height: space.sm }} />
              <Button title="Try again" onPress={run} />
              <Button title="Later" variant="ghost" size="md" onPress={() => setPutOff(true)} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
