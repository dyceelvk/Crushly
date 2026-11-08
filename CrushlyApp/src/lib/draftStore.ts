export type DraftKind = 'post' | 'moment';
export type LocalDraft = {
  id: string;
  kind: DraftKind;
  updatedAt: number;
  body: string;
  data: Record<string, unknown>;
  /** Local durable file URIs, reconstructed when the draft is read. */
  files: Record<string, string>;
};

export type DraftFileSystem = {
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; size?: number }>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  writeAsStringAsync: (uri: string, text: string) => Promise<void>;
  readAsStringAsync: (uri: string) => Promise<string>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
};

/** Platform-independent core; the Android adapter provides private storage. */
export function createDraftStore(FileSystem: DraftFileSystem, root: string, supported = true) {
function userRoot(owner: number): string {
  if (!supported || !root || !Number.isSafeInteger(owner) || owner <= 0) {
    throw new Error('Phone drafts are unavailable right now. Please stay on this screen.');
  }
  return `${root}${owner}/`;
}
function validId(id: string): boolean { return /^[0-9]+-[a-z0-9]+$/.test(id); }
function pathFor(owner: number, id: string): string {
  if (!validId(id)) throw new Error('This draft cannot be opened.');
  return `${userRoot(owner)}${id}/`;
}

/** Each save makes a new complete copy before removing its previous version. */
async function saveLocalDraft(owner: number, draft: Omit<LocalDraft, 'id' | 'updatedAt'>, previousId?: string | null): Promise<LocalDraft> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const dir = pathFor(owner, id);
  const entries: Record<string, string> = {};
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  try {
    for (const [key, uri] of Object.entries(draft.files)) {
      if (!/^[a-z][a-z0-9]*$/.test(key) || !/^(file|content):\/\//i.test(uri)) throw new Error('This media cannot be saved as a phone draft.');
      // Preserve the extension for Android's media readers; do not trust paths
      // or gallery-provided names when creating files inside our directory.
      const ext = /\.([a-z0-9]{1,5})(?:[?#].*)?$/i.exec(uri)?.[1]?.toLowerCase() ?? 'bin';
      const name = `${key}.${ext}`;
      const source = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false }));
      await FileSystem.copyAsync({ from: uri, to: dir + name });
      const stat = await FileSystem.getInfoAsync(dir + name);
      if (source.exists && 'size' in source && source.size && source.size !== stat.size) throw new Error('The draft media copy was incomplete.');
      if (!stat.exists || !('size' in stat) || !stat.size) throw new Error('The draft media could not be saved.');
      entries[key] = name;
    }
    const record = { id, kind: draft.kind, updatedAt: Date.now(), body: draft.body, data: draft.data, files: entries };
    await FileSystem.writeAsStringAsync(dir + 'draft.json', JSON.stringify(record));
    // Only after the new copy is durable can the old one be removed.
    if (previousId && previousId !== id) await deleteLocalDraft(owner, previousId).catch(() => undefined);
    return { ...record, files: Object.fromEntries(Object.entries(entries).map(([key, name]) => [key, dir + name])) };
  } catch (error) {
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

async function listLocalDrafts(owner: number, kind: DraftKind): Promise<LocalDraft[]> {
  const base = userRoot(owner);
  const info = await FileSystem.getInfoAsync(base);
  if (!info.exists) return [];
  const names = await FileSystem.readDirectoryAsync(base);
  const drafts = await Promise.all(names.filter(validId).map(async (id): Promise<LocalDraft | null> => {
    const dir = pathFor(owner, id);
    try {
      const rec = JSON.parse(await FileSystem.readAsStringAsync(dir + 'draft.json')) as LocalDraft;
      if (rec.id !== id || typeof rec.body !== 'string' || !rec.data || !rec.files) throw new Error('Invalid saved draft');
      if (rec.kind !== kind) return null;
      const files: Record<string, string> = {};
      for (const [key, name] of Object.entries(rec.files)) {
        if (!/^[a-z][a-z0-9]*$/.test(key) || typeof name !== 'string' || !/^[a-z][a-z0-9]*\.[a-z0-9]{1,5}$/.test(name)) throw new Error('Invalid saved media');
        const uri = dir + name;
        if (!(await FileSystem.getInfoAsync(uri)).exists) throw new Error('Draft media missing');
        files[key] = uri;
      }
      return { ...rec, files };
    } catch { throw new Error('A draft could not be read. Its files are still on this phone.'); }
  }));
  return drafts.filter((d): d is LocalDraft => !!d).sort((a,b) => b.updatedAt - a.updatedAt);
}
async function deleteLocalDraft(owner: number, id: string): Promise<void> {
  await FileSystem.deleteAsync(pathFor(owner, id), { idempotent: true });
}

return { saveLocalDraft, listLocalDrafts, deleteLocalDraft };
}
