import { supabase } from '../api/client';
import { CallManagerCore, type CallEvents, type Signal, type Transport } from './callCore';
import { callMedia, callPeer, stopCallAudio, callRandomBytes } from './callPlatform';
import { newCallChannel as token } from './callChannel';
export type { CallState, CallEvents } from './callCore';
export function newCallChannel() { return token(callRandomBytes()); }

async function iceServers(channel: string): Promise<RTCIceServer[]> {
  const fallback = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const { data, error } = await supabase.functions.invoke('call-ice', { body: { channel } });
  return !error && Array.isArray(data?.iceServers) ? data.iceServers : fallback;
}
async function join(name: string, receive: (signal: Signal) => void): Promise<Transport> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in again to make calls.');
  await supabase.realtime.setAuth(session.access_token);
  const channel = supabase.channel(name, { config: { private: true, broadcast: { self: false, ack: true } } });
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => receive(payload as Signal));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { void supabase.removeChannel(channel); reject(new Error('Call connection timed out. Check your network.')); }, 10_000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        clearTimeout(timer); reject(new Error('Couldn’t connect to call signaling. Try again.'));
      }
    });
  });
  return {
    send: async signal => {
      const result = await channel.send({ type: 'broadcast', event: 'signal', payload: signal });
      if (result !== 'ok') throw new Error('Call signaling disconnected.');
    },
    close: () => { void supabase.removeChannel(channel); void supabase.rpc('end_call_room', { p_channel: name }); },
  };
}
export class CallManager extends CallManagerCore {
  constructor(events: CallEvents) { super(events, { media: callMedia, peer: async name => callPeer(await iceServers(name)), join, stopAudio: stopCallAudio }); }
}
