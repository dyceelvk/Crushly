import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet, ConfirmSheet } from './BottomSheet';
import { Button } from './Button';
import { Txt } from './Txt';
import { useToast } from './Toast';
import { deleteLocalDraft, listLocalDrafts, type DraftKind, type LocalDraft } from '../lib/localDrafts';
import { space } from '../theme/tokens';

export function LocalDraftsSheet({ visible, owner, kind, onClose, onOpen }: {
  visible: boolean; owner: number; kind: DraftKind; onClose: () => void; onOpen: (draft: LocalDraft) => void;
}) {
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [remove, setRemove] = useState<LocalDraft | null>(null);
  const toast = useToast();
  const refresh = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try { setDrafts(await listLocalDrafts(owner, kind)); }
    catch { setLoadError(true); toast({ kind: 'error', title: 'Drafts could not be loaded', message: 'Your saved files are still on this phone.' }); }
    finally { setLoading(false); }
  }, [owner, kind, toast]);
  useEffect(() => { if (visible) void refresh(); }, [visible, refresh]);
  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title="Drafts on this phone" subtitle="Only on this phone, for this account. Uninstalling the app deletes them.">
        {loading ? <Txt variant="body">Loading drafts…</Txt> : loadError ? <Txt variant="body">Drafts could not be read. Your saved files are still on this phone.</Txt> : !drafts.length ? <Txt variant="body">No saved drafts yet.</Txt> : drafts.map((draft) => (
          <View key={draft.id} style={{ paddingVertical: space.sm, gap: space.xs }}>
            <Txt variant="bodyStrong" numberOfLines={2}>{draft.body.trim() || (Object.keys(draft.files).length ? 'Media draft' : 'Untitled draft')}</Txt>
            <Txt variant="small" color="textSecondary">{new Date(draft.updatedAt).toLocaleString()}</Txt>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Open draft" size="sm" full={false} onPress={() => onOpen(draft)} />
              <Button title="Delete" size="sm" variant="ghost" full={false} onPress={() => setRemove(draft)} />
            </View>
          </View>
        ))}
      </BottomSheet>
      <ConfirmSheet visible={!!remove} title="Delete this draft?" message="This removes the phone copy. It cannot be undone." confirmLabel="Delete draft" destructive onCancel={() => setRemove(null)} onConfirm={() => {
        const draft = remove; setRemove(null);
        if (!draft) return;
        void deleteLocalDraft(owner, draft.id).then(refresh).catch(() => toast({ kind: 'error', title: 'Draft not deleted', message: 'Please try again.' }));
      }} />
    </>
  );
}

export function LeaveDraftSheet({ visible, canSave, saving, onSave, onDiscard, onClose }: {
  visible: boolean; canSave: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; onClose: () => void;
}) {
  return <BottomSheet visible={visible} onClose={onClose} title="Leave this editor?" subtitle={canSave ? 'Save a draft to this phone, or discard your changes.' : 'Your changes have not been saved.'}>
    <View style={{ gap: space.xs }}>
      {canSave ? <Button title="Save draft on this phone" onPress={onSave} loading={saving} disabled={saving} /> : null}
      <Button title="Discard changes" variant="danger" onPress={onDiscard} disabled={saving} />
      <Button title="Keep editing" variant="ghost" onPress={onClose} disabled={saving} />
    </View>
  </BottomSheet>;
}
