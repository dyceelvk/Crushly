/**
 * The phone's copy of the chat.
 *
 * Whispers are the phones', not the server's: the server relays and releases,
 * this store is what the member actually reads. A conversation lives here
 * until the app is deleted — and a fresh phone starts empty, because the
 * server does not keep unbacked Whispers around to refill it. Backed-up
 * chats (see "Back up this chat") are the exception: those reload from the
 * server anywhere.
 *
 * Storage: localStorage in the browser, a JSON file per conversation on
 * native via expo-file-system — no new dependencies.
 */

type Msg = { id: number } & Record<string, unknown>;

const web = typeof localStorage !== 'undefined';

type FsModule = {
  documentDirectory?: string;
  cacheDirectory?: string;
  Paths?: { document?: unknown; cache?: unknown };
  File?: new (...args: unknown[]) => {
    textSync?: () => string;
    writeSync?: (d: string) => void;
  };
  Directory?: new (...args: unknown[]) => { create?: (o?: unknown) => void };
  readAsStringAsync?: (p: string) => Promise<string>;
  writeAsStringAsync?: (p: string, d: string) => Promise<void>;
  getInfoAsync?: (p: string) => Promise<{ exists: boolean }>;
  makeDirectoryAsync?: (p: string, o?: { intermediates?: boolean }) => Promise<void>;
};

function uriOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'uri' in v && typeof (v as { uri?: unknown }).uri === 'string') {
    return (v as { uri: string }).uri;
  }
  return null;
}

async function fsStore(): Promise<{
  read: (path: string) => Promise<string | null>;
  write: (path: string, data: string) => Promise<void>;
} | null> {
  if (web) return null;
  try {
    const FS = (await import('expo-file-system')) as unknown as FsModule;
    // New File/Directory API first, the classic string API behind it.
    if (FS.File && FS.Directory && FS.Paths) {
      const FileCtor = FS.File;
      const base = uriOf(FS.Paths.document) ?? uriOf(FS.Paths.cache);
      if (!base) return null;
      const dir = new FS.Directory(base, 'chat-store');
      try {
        dir.create?.({ intermediates: true });
      } catch {
        /* exists */
      }
      return {
        read: async (path) => {
          try {
            return new FileCtor(dir as unknown, `${path}.json`).textSync?.() ?? null;
          } catch {
            return null;
          }
        },
        write: async (path, data) => {
          try {
            new FileCtor(dir as unknown, `${path}.json`).writeSync?.(data);
          } catch {
            /* convenience, not the record */
          }
        },
      };
    }
    const base = FS.documentDirectory ?? FS.cacheDirectory ?? null;
    if (!base || !FS.readAsStringAsync || !FS.writeAsStringAsync) return null;
    const dir = `${base}chat-store`;
    const ensure = async () => {
      const info = await FS.getInfoAsync?.(dir);
      if (!info?.exists) await FS.makeDirectoryAsync?.(dir, { intermediates: true });
    };
    return {
      read: async (path) => {
        try {
          return (await FS.readAsStringAsync?.(`${dir}/${path}`)) ?? null;
        } catch {
          return null;
        }
      },
      write: async (path, data) => {
        await ensure();
        await FS.writeAsStringAsync?.(`${dir}/${path}`, data);
      },
    };
  } catch {
    return null;
  }
}

function key(userId: number | null, conversationId: number) {
  return `msgs-${userId ?? 'anon'}-${conversationId}`;
}
function delKey(userId: number | null) {
  return `msgs-del-${userId ?? 'anon'}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  if (web) {
    try {
      const raw = localStorage.getItem(path);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  const store = await fsStore();
  if (!store) return null;
  try {
    const raw = await store.read(`${path}.json`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value);
  if (web) {
    try {
      localStorage.setItem(path, data);
    } catch {
      /* quota — the cache is a convenience, not the record */
    }
    return;
  }
  const store = await fsStore();
  if (store) await store.write(`${path}.json`, data).catch(() => undefined);
}

/** Everything the phone remembers of one conversation. */
export async function loadCachedMessages<T>(userId: number | null, conversationId: number): Promise<T[]> {
  const rows = (await readJson<Msg[]>(key(userId, conversationId))) ?? [];
  const gone = new Set((await readJson<number[]>(delKey(userId))) ?? []);
  return rows.filter((m) => !gone.has(m.id)) as unknown as T[];
}

/** Keep the phone's copy in step with what is in memory. */
export async function saveCachedMessages(userId: number | null, conversationId: number, messages: ReadonlyArray<{ id: number }>): Promise<void> {
  await writeJson(key(userId, conversationId), messages.slice(-500));
}

/**
 * A message deleted is deleted everywhere: remember the id so a cached copy
 * can never resurrect it.
 */
export async function tombstoneMessage(userId: number | null, conversationId: number, id: number): Promise<void> {
  const gone = (await readJson<number[]>(delKey(userId))) ?? [];
  if (!gone.includes(id)) gone.push(id);
  await writeJson(delKey(userId), gone.slice(-2000));
  const rows = (await readJson<Msg[]>(key(userId, conversationId))) ?? [];
  await writeJson(key(userId, conversationId), rows.filter((m) => m.id !== id));
}

/**
 * Server rows and the phone's copy, as one thread: the server wins for ids it
 * still has, the phone keeps what the server has already released, and
 * tombstones keep deleted things deleted.
 */
export function mergeCached<T extends { id: number }>(cached: T[], fromServer: T[]): T[] {
  const map = new Map<number, T>();
  for (const m of cached) map.set(m.id, m);
  for (const m of fromServer) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
}
