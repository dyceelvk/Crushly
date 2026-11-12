/**
 * Whisper, live.
 *
 * One private Realtime channel per conversation — `whisper:<id>` — carrying only
 * *signals*, never content:
 *
 *   message     "there is something new in this thread"  (the id, nothing else)
 *   delivered   "my device has everything up to <id>"
 *   read        "I have opened it up to <id>"  (only when receipts are allowed)
 *   typing      "I am writing", refreshed while true, expiring on its own
 *   recording   "I am recording a voice note"
 *   presence    "I am in this conversation right now"
 *
 * The message itself is still fetched through `get_messages`, where audience,
 * block and receipt rules already live, so a channel can never become a second,
 * weaker way to read a Whisper.
 *
 * Authorisation is the database's (`can_join_whisper` + an RLS policy on
 * `realtime.messages`): the two members of an open thread, and nobody else. This
 * file assumes that and never tries to be the guard itself.
 *
 * Honest failure: if the socket cannot connect, `onStatus('offline')` says so and
 * the screen falls back to its slow poll. Nothing here pretends to be live.
 */

import { supabase } from '../api/client';

export type WhisperLiveStatus = 'connecting' | 'live' | 'offline';

export type WhisperLiveEvents = {
  /** Something new happened in the thread; the caller refetches from its last id. */
  onNewMessage: () => void;
  /**
   * A Whisper was taken back. This cannot be discovered by refetching: the
   * incremental fetch asks for ids *after* the newest one, so a removal is
   * invisible to it. It has to be pushed.
   */
  onMessageDeleted: (messageId: number) => void;
  /** Their device has my messages up to this id. */
  onDelivered: (upTo: number) => void;
  /** They have read up to this id — only ever sent when receipts are allowed. */
  onRead: (upTo: number) => void;
  /** Typing, refreshed while true. `at = 0` means they stopped. */
  onTyping: (at: number) => void;
  /** Recording a voice note, refreshed while true. `at = 0` means stopped. */
  onRecording: (at: number) => void;
  /** They are (or are no longer) on this conversation right now. */
  onPeerHere: (here: boolean) => void;
  /** Whether the channel is actually connected — for the honest header note. */
  onStatus: (status: WhisperLiveStatus) => void;
};

export type WhisperLive = {
  /** Tell the other phone something arrived. Cheap, content-free. */
  announce: (messageId: number) => void;
  /** Tell the other phone a message is gone, so it stops showing it. */
  deleted: (messageId: number) => void;
  delivered: (upTo: number) => void;
  read: (upTo: number) => void;
  typing: (on: boolean) => void;
  recording: (on: boolean) => void;
  /** Announce my own presence, or stop doing so (their privacy switch / background). */
  setPresence: (on: boolean) => void;
  status: () => WhisperLiveStatus;
  close: () => void;
};

type Options = {
  conversationId: number;
  /** My profile id, so presence can be told apart from "somebody else". */
  myId: number | null;
  /** May my presence be announced? Comes from `peer_presence().announce`. */
  announcePresence: boolean;
  events: WhisperLiveEvents;
};

export function whisperTopic(conversationId: number): string {
  return `whisper:${conversationId}`;
}

export function openWhisperLive({ conversationId, myId, announcePresence, events }: Options): WhisperLive {
  let status: WhisperLiveStatus = 'connecting';
  let live: WhisperLive | null = null;
  let presenceWanted = announcePresence;
  let closed = false;
  let typingAt = 0;
  let recordingAt = 0;

  const setStatus = (s: WhisperLiveStatus) => {
    if (status === s) return;
    status = s;
    events.onStatus(s);
  };

  // The token has to be the session's, not the anon key's: a private channel is
  // authorised as the signed-in member or not at all.
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (closed) return;
      if (!session) {
        setStatus('offline');
        return;
      }
      await supabase.realtime.setAuth(session.access_token);
      if (closed) return;

      const channel = supabase.channel(whisperTopic(conversationId), {
        config: {
          private: true,
          broadcast: { self: false, ack: true },
          presence: { key: myId ? String(myId) : 'me' },
        },
      });

      channel.on('broadcast', { event: 'message' }, ({ payload }) => {
        const id = Number((payload as { id?: number })?.id ?? 0);
        if (id > 0) events.onNewMessage();
      });
      channel.on('broadcast', { event: 'deleted' }, ({ payload }) => {
        const id = Number((payload as { id?: number })?.id ?? 0);
        if (id > 0) events.onMessageDeleted(id);
      });
      channel.on('broadcast', { event: 'delivered' }, ({ payload }) => {
        const upTo = Number((payload as { upTo?: number })?.upTo ?? 0);
        if (upTo > 0) events.onDelivered(upTo);
      });
      channel.on('broadcast', { event: 'read' }, ({ payload }) => {
        const upTo = Number((payload as { upTo?: number })?.upTo ?? 0);
        if (upTo > 0) events.onRead(upTo);
      });
      channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
        const at = Number((payload as { at?: number })?.at ?? 0);
        events.onTyping(at);
      });
      channel.on('broadcast', { event: 'recording' }, ({ payload }) => {
        const at = Number((payload as { at?: number })?.at ?? 0);
        events.onRecording(at);
      });

      // Presence: "here" means somebody other than me is on this conversation.
      const sync = () => {
        const state = channel.presenceState() as Record<string, unknown[]>;
        const other = Object.keys(state).some((key) => key !== (myId ? String(myId) : 'me') && (state[key]?.length ?? 0) > 0);
        events.onPeerHere(other);
      };
      channel.on('presence', { event: 'sync' }, sync);
      channel.on('presence', { event: 'join' }, sync);
      channel.on('presence', { event: 'leave' }, sync);

      await new Promise<void>((resolve) => {
        channel.subscribe((s) => {
          if (s === 'SUBSCRIBED') {
            setStatus('live');
            if (presenceWanted) void channel.track({ at: Date.now() });
            resolve();
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
            // Realtime retries on its own; until it does, the truth is "offline"
            // and the screen says so instead of showing a dot that means nothing.
            setStatus('offline');
            events.onPeerHere(false);
            resolve();
          } else {
            setStatus('connecting');
          }
        });
      });

      const fire = (event: string, payload: Record<string, unknown>) => {
        if (status !== 'live') return;
        void channel.send({ type: 'broadcast', event, payload });
      };

      live = {
        announce: (messageId: number) => fire('message', { id: messageId }),
        deleted: (messageId: number) => fire('deleted', { id: messageId }),
        delivered: (upTo: number) => fire('delivered', { upTo }),
        read: (upTo: number) => fire('read', { upTo }),
        typing: (on: boolean) => {
          // Only the edges are sent plus a heartbeat while true: a keystroke is
          // not a packet.
          const now = Date.now();
          if (on && now - typingAt < 2500) return;
          typingAt = on ? now : 0;
          fire('typing', { at: on ? now : 0 });
        },
        recording: (on: boolean) => {
          const now = Date.now();
          if (on && now - recordingAt < 5000) return;
          recordingAt = on ? now : 0;
          fire('recording', { at: on ? now : 0 });
        },
        setPresence: (on: boolean) => {
          presenceWanted = on;
          /* The wish is remembered even while the channel is still connecting —
             otherwise a header that resolved before the socket did would leave
             presence permanently unannounced. */
          if (status !== 'live') return;
          if (on) void channel.track({ at: Date.now() });
          else void channel.untrack();
        },
        status: () => status,
        close: () => {
          closed = true;
          void supabase.removeChannel(channel);
        },
      };

      if (closed) live.close();
    } catch {
      setStatus('offline');
    }
  })();

  return {
    announce: (id) => live?.announce(id),
    deleted: (id) => live?.deleted(id),
    delivered: (upTo) => live?.delivered(upTo),
    read: (upTo) => live?.read(upTo),
    typing: (on) => live?.typing(on),
    recording: (on) => live?.recording(on),
    setPresence: (on) => {
      presenceWanted = on;
      live?.setPresence(on);
    },
    status: () => status,
    close: () => {
      closed = true;
      live?.close();
    },
  };
}
