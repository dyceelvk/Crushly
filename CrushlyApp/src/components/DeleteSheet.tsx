/**
 * The one delete dialog.
 *
 * Every bin in holUpp opens this, and nothing is removed until `Delete` is
 * pressed. It owns the three states a careful delete needs and which were
 * missing one screen at a time:
 *
 *   asking   — the question, with Cancel and Delete both clearly answers
 *   working  — Delete spins, Cancel is refused, the sheet cannot be dismissed
 *   done     — a success message; a failure message if it did not work, and the
 *              dialog stays open so the member can try again
 *
 * The database is only touched inside `onConfirm`, which only runs after the
 * press, so a stray tap on a bin can never delete anything.
 */
import { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Txt } from './Txt';
import { useToast } from './Toast';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { DELETE_COPY, deleteDetail, deleteErrorTitle, deleteOutcome, deleteSuccessTitle, type DeleteRequest } from '../lib/deleteCopy';

export function DeleteSheet({
  visible,
  onConfirm,
  onCancel,
  detail,
  successTitle,
  errorTitle,
}: {
  visible: boolean;
  /** Do the delete. Throwing is how it reports failure. */
  onConfirm: () => Promise<unknown> | void;
  onCancel: () => void;
  detail?: string;
  successTitle?: string;
  errorTitle?: string;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const request: DeleteRequest = { detail, successTitle, errorTitle };

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    let ok = true;
    try {
      await onConfirm();
    } catch {
      ok = false;
    } finally {
      setBusy(false);
    }
    const outcome = deleteOutcome(ok);
    if (outcome.kind === 'success') {
      toast({ kind: 'success', title: deleteSuccessTitle(request), message: 'It’s gone.' });
    } else {
      toast({
        kind: 'error',
        title: deleteErrorTitle(request),
        message: 'Nothing was deleted. Check your connection and try again.',
      });
    }
    if (outcome.close) onCancel();
  }, [busy, onConfirm, onCancel, toast, request]);

  const note = deleteDetail(detail);

  return (
    <BottomSheet
      visible={visible}
      /* A delete in flight cannot be swiped away: the request is out and the
         answer decides what the member sees. */
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={DELETE_COPY.title}
      subtitle={DELETE_COPY.message}
    >
      <View style={{ gap: space.sm, paddingTop: space.xs }}>
        {note ? (
          <View
            style={{
              flexDirection: 'row',
              gap: 10,
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.dangerSoft,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Txt variant="small" color="textSecondary" style={{ flex: 1 }}>
              {note}
            </Txt>
          </View>
        ) : null}
        <Button
          title={DELETE_COPY.confirmLabel}
          variant="danger"
          loading={busy}
          onPress={() => void run()}
        />
        <Button
          title={DELETE_COPY.cancelLabel}
          variant="ghost"
          disabled={busy}
          onPress={() => {
            if (!busy) onCancel();
          }}
        />
      </View>
    </BottomSheet>
  );
}
