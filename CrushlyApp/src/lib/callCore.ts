/** Platform-independent signaling; native and browser media live in callPlatform. */
export type CallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';
export type Signal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'ready' | 'hangup' | 'decline' };
export type CallEvents = {
  onState: (s: CallState) => void;
  onRemote: (stream: MediaStream | null) => void;
  onError: (message: string) => void;
  onEnd: (reason: string | null) => void;
};
export type Transport = { send: (signal: Signal) => Promise<void>; close: () => void };
export type CallDependencies = {
  media: () => Promise<MediaStream>;
  peer: (name: string) => Promise<RTCPeerConnection>;
  join: (name: string, receive: (signal: Signal) => void) => Promise<Transport>;
  stopAudio: () => void;
};
const RING_MS = 45_000;

export class CallManagerCore {
  state: CallState = 'idle';
  muted = false;
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private transport: Transport | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private localIce: RTCIceCandidateInit[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private receiving: Promise<void> = Promise.resolve();
  private accepted = false;
  private caller = false;
  private offerSent = false;
  private channelName = '';
  constructor(private events: CallEvents, private deps: CallDependencies) {}
  private setState(state: CallState) { this.state = state; this.events.onState(state); }
  private send(signal: Signal) { return this.transport?.send(signal) ?? Promise.resolve(); }
  private ringTimeout() { this.timer = setTimeout(() => { void this.end('No answer', 'hangup'); }, RING_MS); }
  private async join(name: string, generation: number) {
    const transport = await this.deps.join(name, (signal) => {
      this.receiving = this.receiving.then(async () => {
        if (generation === this.generation && this.state !== 'idle') await this.onSignal(signal);
      }).catch(() => this.fail('The call connection failed. Please try again.'));
    });
    if (generation !== this.generation) { transport.close(); return false; }
    this.transport = transport;
    return true;
  }
  private async setup(generation: number) {
    const local = await this.deps.media();
    if (generation !== this.generation) { local.getTracks().forEach(t => t.stop()); this.deps.stopAudio(); return false; }
    this.local = local;
    const pc = await this.deps.peer(this.channelName);
    if (generation !== this.generation) { pc.close(); return false; }
    this.pc = pc;
    local.getTracks().forEach(t => pc.addTrack(t, local));
    pc.onicecandidate = e => {
      if (e.candidate) {
        const candidate = e.candidate.toJSON();
        this.localIce.push(candidate);
        void this.send({ type: 'ice', candidate }).catch(() => this.fail('Call signaling disconnected.'));
      }
    };
    pc.ontrack = e => this.events.onRemote(e.streams[0] ?? null);
    const connected = () => {
      if (generation !== this.generation) return;
      if (pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState)) {
        this.clearTimers(); this.setState('active');
      } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
        this.fail('Couldn’t connect. Try another network; this network may require a call relay.');
      }
    };
    pc.onconnectionstatechange = connected;
    pc.oniceconnectionstatechange = connected;
    return true;
  }
  private async flushIce() {
    while (this.pc?.remoteDescription && this.pendingIce.length) await this.pc.addIceCandidate(this.pendingIce.shift()!);
  }
  private async onSignal(signal: Signal) {
    if (!signal || typeof signal.type !== 'string') return;
    if (signal.type === 'hangup' || signal.type === 'decline') { this.finish(signal.type === 'decline' ? 'Declined' : 'Ended'); return; }
    if (signal.type === 'ready' && this.caller && this.pc?.localDescription?.sdp) {
      // ICE gathered before the callee subscribed is replayed with the offer.
      await this.send({ type: 'offer', sdp: this.pc.localDescription.sdp });
      for (const candidate of this.localIce) await this.send({ type: 'ice', candidate });
      this.offerSent = true;
    } else if (signal.type === 'offer' && !this.caller && this.accepted && this.pc) {
      if (typeof signal.sdp !== 'string' || signal.sdp.length > 100_000) return;
      if (!this.pc.remoteDescription) {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        await this.flushIce();
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.setState('connecting');
      }
      await this.send({ type: 'answer', sdp: this.pc.localDescription!.sdp });
      for (const candidate of this.localIce) await this.send({ type: 'ice', candidate });
    } else if (signal.type === 'answer' && this.caller && this.offerSent && this.pc && !this.pc.remoteDescription) {
      if (typeof signal.sdp !== 'string' || signal.sdp.length > 100_000) return;
      await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushIce(); this.setState('connecting');
    } else if (signal.type === 'ice' && signal.candidate && this.pc) {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(signal.candidate);
      else if (this.pendingIce.length < 128) this.pendingIce.push(signal.candidate);
    }
  }
  async call(name: string) {
    if (this.state !== 'idle') return;
    const generation = ++this.generation;
    this.caller = true; this.channelName = name; this.setState('outgoing');
    try {
      if (!await this.join(name, generation) || !await this.setup(generation)) return;
      await this.pc!.setLocalDescription(await this.pc!.createOffer());
      this.ringTimeout();
    } catch (error) { if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Allow microphone access to make calls.'); }
  }
  async incoming(name: string) {
    if (this.state !== 'idle') return;
    const generation = ++this.generation;
    this.caller = false; this.channelName = name; this.setState('incoming');
    try { if (await this.join(name, generation)) this.ringTimeout(); }
    catch { if (generation === this.generation) this.fail('Couldn’t receive this call. Please try again.'); }
  }
  async accept(name: string) {
    if (this.state !== 'incoming' || this.accepted || name !== this.channelName) return;
    this.accepted = true;
    const generation = this.generation;
    try {
      // incoming() may still be subscribing when Accept is tapped.
      if (!this.transport) { this.accepted = false; this.events.onError('Connecting to the caller — tap Accept again in a moment.'); return; }
      if (!await this.setup(generation)) return;
      this.setState('connecting');
      await this.send({ type: 'ready' });
      this.readyTimer = setInterval(() => { if (!this.pc?.remoteDescription) void this.send({ type: 'ready' }).catch(() => this.fail('Call signaling disconnected.')); }, 1000);
    } catch (error) { if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Allow microphone access to answer calls.'); }
  }
  toggleMute() { this.muted = !this.muted; this.local?.getAudioTracks().forEach(t => { t.enabled = !this.muted; }); return this.muted; }
  decline() { return this.end('Declined', 'decline'); }
  hangup() { return this.end('Ended', 'hangup'); }
  private async end(reason: string, type: 'hangup' | 'decline') {
    if (this.state === 'idle') return;
    // Detach locally at once, but allow the terminal broadcast to be acknowledged.
    const transport = this.transport;
    this.transport = null;
    this.finish(reason);
    try { await transport?.send({ type }); } finally { transport?.close(); }
  }
  private fail(message: string) { this.events.onError(message); void this.end('Connection failed', 'hangup').catch(() => {}); }
  private clearTimers() { if (this.timer) clearTimeout(this.timer); if (this.readyTimer) clearInterval(this.readyTimer); this.timer = null; this.readyTimer = null; }
  private finish(reason: string) {
    ++this.generation; this.clearTimers();
    this.pc?.close(); this.pc = null;
    this.local?.getTracks().forEach(t => t.stop()); this.local = null;
    this.deps.stopAudio(); this.transport?.close(); this.transport = null;
    this.pendingIce = []; this.localIce = []; this.accepted = false; this.offerSent = false; this.muted = false;
    this.events.onRemote(null); this.setState('idle'); this.events.onEnd(reason);
  }
}
