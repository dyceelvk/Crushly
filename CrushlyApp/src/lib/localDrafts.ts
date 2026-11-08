import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createDraftStore } from './draftStore';
export type { DraftKind, LocalDraft } from './draftStore';
export const localDraftsAvailable = Platform.OS === 'android' && !!FileSystem.documentDirectory;
const store = createDraftStore(FileSystem, `${FileSystem.documentDirectory ?? ''}hollop-drafts/`, localDraftsAvailable);
export const { saveLocalDraft, listLocalDrafts, deleteLocalDraft } = store;
