import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCallChannel, callMessageMeta } from './callChannel';
import { lowLatencySdp } from './callAudio';

test('newCallChannel makes unguessable per-call channel names', () => {
  const a = newCallChannel();
  assert.match(a, /^call-[a-f0-9]{32}$/);
  assert.ok(a.length > 20);
});

test('newCallChannel never repeats', () => {
  const names = new Set(Array.from({ length: 500 }, () => newCallChannel()));
  assert.equal(names.size, 500);
});

test('call invitations retain their channel for the server and recipient', () => {
  const channel = newCallChannel();
  assert.deepEqual(callMessageMeta(channel), { channel });
  assert.throws(() => callMessageMeta(''));
});

import { CallManagerCore, type CallDependencies, type Signal, type CallState } from './callCore';

function fixture() {
  let receive: (signal: Signal) => void = () => {};
  const sent: Signal[] = [];
  const states: CallState[] = [];
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const candidates: RTCIceCandidateInit[] = [];
  const pc = {
    localDescription: null as RTCSessionDescriptionInit | null,
    remoteDescription: null as RTCSessionDescriptionInit | null,
    connectionState: 'new', iceConnectionState: 'new', closed: false,
    addTrack() {}, close() { this.closed = true; },
    createOffer: async () => ({ type: 'offer', sdp: 'offer-sdp' }),
    createAnswer: async () => ({ type: 'answer', sdp: 'answer-sdp' }),
    async setLocalDescription(sdp: RTCSessionDescriptionInit) { this.localDescription = sdp; },
    async setRemoteDescription(sdp: RTCSessionDescriptionInit) { this.remoteDescription = sdp; },
    async addIceCandidate(candidate: RTCIceCandidateInit) { assert.ok(this.remoteDescription); candidates.push(candidate); },
    onconnectionstatechange: () => {}, oniceconnectionstatechange: () => {},
    onicecandidate: (_e: unknown) => {},
  };
  const deps: CallDependencies = {
    media: async () => stream, peer: async () => pc as unknown as RTCPeerConnection,
    join: async (_name, listener) => { receive = listener; return { send: async s => { sent.push(s); }, close() {} }; },
    stopAudio() {},
  };
  const manager = new CallManagerCore({ onState: s => states.push(s), onRemote() {}, onError() {}, onEnd() {} }, deps);
  return { manager, deps, pc, sent, track, candidates, states, signal: async (s: Signal) => { receive(s); await new Promise(resolve => setImmediate(resolve)); } };
}

test('caller waits for readiness, replays gathered ICE and activates only on connection', async () => {
  const f = fixture();
  await f.manager.call('call-token');
  assert.equal(f.manager.state, 'outgoing');
  f.pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'local-ice' }) } });
  await f.signal({ type: 'ready' });
  assert.ok(f.sent.some(s => s.type === 'offer'));
  assert.equal(f.sent.filter(s => s.type === 'ice').length, 2, 'replay ICE missed before callee joined');
  await f.signal({ type: 'ice', candidate: { candidate: 'remote-ice' } });
  assert.equal(f.candidates.length, 0);
  await f.signal({ type: 'answer', sdp: 'answer-sdp' });
  assert.equal(f.candidates.length, 1);
  assert.equal(f.manager.state, 'connecting', 'SDP is not proof of connected audio');
  f.pc.connectionState = 'connected'; f.pc.onconnectionstatechange();
  assert.equal(f.manager.state, 'active');
  assert.equal(f.manager.toggleMute(), true); assert.equal(f.track.enabled, false);
  await f.manager.hangup();
  assert.equal(f.manager.state, 'idle'); assert.ok(f.track.stopped); assert.ok(f.pc.closed);
});

test('incoming decline is broadcast before transport teardown without opening the microphone', async () => {
  const f = fixture();
  let mic = false; f.deps.media = async () => { mic = true; throw Error('unused'); };
  await f.manager.incoming('call-token');
  await f.manager.decline();
  assert.equal(mic, false); assert.deepEqual(f.sent, [{ type: 'decline' }]); assert.equal(f.manager.state, 'idle');
});

test('accept buffers early ICE and handles duplicate offers idempotently', async () => {
  const f = fixture(); await f.manager.incoming('call-token'); await f.manager.accept('call-token');
  await f.signal({ type: 'ice', candidate: { candidate: 'early' } });
  await f.signal({ type: 'offer', sdp: 'offer-sdp' });
  await f.signal({ type: 'offer', sdp: 'offer-sdp' });
  assert.equal(f.candidates.length, 1); assert.equal(f.manager.state, 'connecting');
  assert.equal(f.sent.filter(s => s.type === 'answer').length, 2);
  await f.signal({ type: 'hangup' }); assert.ok(f.track.stopped); assert.equal(f.manager.state, 'idle');
});

test('cancel while microphone permission is pending cleans up the eventual stream', async () => {
  const f = fixture(); let release!: (s: MediaStream) => void;
  f.deps.media = () => new Promise(resolve => { release = resolve; });
  const starting = f.manager.call('call-token'); await new Promise(resolve => setImmediate(resolve));
  await f.manager.hangup();
  release({ getTracks: () => [f.track] } as unknown as MediaStream);
  await starting; assert.ok(f.track.stopped); assert.equal(f.manager.state, 'idle');
});


test('native media release is called on hang-up, not just track disable', async () => {
  const f = fixture(); let released = 0;
  f.deps.releaseMedia = () => { released++; };
  await f.manager.call('call-token'); await f.manager.hangup(); assert.equal(released, 1);
});

test('the SDP rewriter retunes Opus for back-and-forth conversation', () => {
  const sdp = [
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:0 PCMU/8000',
  ].join('\r\n');
  const out = lowLatencySdp(sdp);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;usedtx=0;stereo=0;maxaveragebitrate=24000;maxplaybackrate=16000/);
  // Other codecs are left alone — we are not in the business of guessing.
  assert.match(out, /a=rtpmap:0 PCMU\/8000/);
});

test('an SDP we do not recognise is passed through untouched', () => {
  for (const sdp of ['', 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000']) {
    assert.equal(lowLatencySdp(sdp), sdp);
  }
});
