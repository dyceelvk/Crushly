/**
 * Peer-to-peer voice calls over WebRTC, signalled through a Supabase Realtime
 * broadcast channel. The channel name is a random per-call token sent inside
 * the 'call' chat message, so only the two members ever join it.
 *
 * Flow: caller creates the offer → callee joins, says "ready" → caller re-sends
 * the offer → callee answers → trickle ICE both ways. Web only (React Native
 * has no WebRTC without a native module); the UI says so honestly on native.
 */
import { supabase } from '../api/client';
import { newCallChannel } from './callChannel';

export { newCallChannel };

export type CallState = 'idle' | 'outgoing' | 'incoming' | 'active';

type Signal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'ready' }
  | { type: 'hangup' }
  | { type: 'decline' };

export type CallEvents = {
  onState: (s: CallState) => void;
  onRemote: (stream: MediaStream | null) => void;
  onError: (message: string) => void;
  /** Human-readable end reason ("No answer", "Declined", "Ended") — null when still ringing. */
  onEnd: (reason: string | null) => void;
};

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const NO_ANSWER_MS = 30_000;

type Channel = ReturnType<typeof supabase.channel>;

export class CallManager {
  state: CallState = 'idle';
  muted = false;
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private channel: Channel | null = null;
  private events: CallEvents;
  private noAnswer: ReturnType<typeof setTimeout> | null = null;
  private offerSdp: string | null = null;

  constructor(events: CallEvents) {
    this.events = events;
  }

  private setState(s: CallState) {
    this.state = s;
    this.events.onState(s);
  }

  private send(sig: Signal) {
    this.channel?.send({ type: 'broadcast', event: 'signal', payload: sig }).catch(() => {});
  }

  private setupPeer() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => this.events.onRemote(e.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.events.onError('The call couldn’t connect — check your network and try again.');
        this.finish('Connection failed');
      }
    };
  }

  private joinChannel(name: string) {
    const channel = supabase.channel(name, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload as Signal));
    channel.subscribe();
    this.channel = channel;
  }

  private async onSignal(sig: Signal) {
    if (this.state === 'idle') return;
    switch (sig.type) {
      case 'ready':
        // Callee joined — re-send the offer (broadcasts are not replayed).
        if (this.offerSdp) this.send({ type: 'offer', sdp: this.offerSdp });
        break;
      case 'offer':
        if (this.state !== 'incoming') return;
        try {
          await this.pc!.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);
          this.send({ type: 'answer', sdp: answer.sdp! });
          this.clearNoAnswer();
          this.setState('active');
        } catch {
          this.events.onError('Couldn’t join the call — try again.');
          this.finish('Connection failed');
        }
        break;
      case 'answer':
        if (this.state !== 'outgoing' || !this.pc) return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
        this.clearNoAnswer();
        this.setState('active');
        break;
      case 'ice':
        if (this.pc) await this.pc.addIceCandidate(sig.candidate).catch(() => {});
        break;
      case 'hangup':
        this.finish('Ended');
        break;
      case 'decline':
        this.finish('Declined');
        break;
    }
  }

  /** Caller side: mic → peer → channel → offer. */
  async call(channelName: string): Promise<void> {
    if (this.state !== 'idle') return;
    this.setState('outgoing');
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.setupPeer();
      this.joinChannel(channelName);
      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);
      this.offerSdp = offer.sdp ?? null;
      this.send({ type: 'offer', sdp: offer.sdp! });
      this.noAnswer = setTimeout(() => this.finish('No answer'), NO_ANSWER_MS);
    } catch {
      this.events.onError('Allow microphone access to make calls.');
      this.finish('Couldn’t start');
    }
  }

  /** Callee side: accept an incoming call on its channel. */
  async accept(channelName: string): Promise<void> {
    if (this.state !== 'incoming') return;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.setupPeer();
      this.joinChannel(channelName);
      this.send({ type: 'ready' });
    } catch {
      this.events.onError('Allow microphone access to answer calls.');
      this.finish('Couldn’t join');
    }
  }

  /** Show an incoming call (the offer arrives over the channel after accept). */
  incoming(channelName: string) {
    if (this.state !== 'idle') return;
    this.channelName = channelName;
    this.setState('incoming');
  }

  private channelName = '';

  decline() {
    if (this.state === 'incoming') this.send({ type: 'decline' });
    this.finish(this.state === 'incoming' ? 'Declined' : 'Ended');
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    return this.muted;
  }

  hangup() {
    if (this.state === 'active' || this.state === 'outgoing') this.send({ type: 'hangup' });
    this.finish('Ended');
  }

  private clearNoAnswer() {
    if (this.noAnswer) clearTimeout(this.noAnswer);
    this.noAnswer = null;
  }

  private finish(reason: string) {
    if (this.state === 'idle') return;
    this.clearNoAnswer();
    this.send({ type: 'hangup' });
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.pc = null;
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.channel?.unsubscribe().catch(() => {});
    this.channel = null;
    this.offerSdp = null;
    this.events.onRemote(null);
    this.setState('idle');
    this.events.onEnd(reason);
  }
}
