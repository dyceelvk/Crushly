import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cutRange, isTrimOnly, planEncode } from './videoEncode';
import { emptyEdit, type VideoEdit } from './videoEdit';

const SRC = 60;

function plan(over: Partial<VideoEdit> = {}, opts: { music?: string | null; category?: 'post' | 'vibe' | 'moment' | 'circle' } = {}) {
  const edit = { ...emptyEdit(SRC), ...over };
  const { captions: _c, stickers: _s, ...baked } = edit;
  return planEncode(baked, {
    input: 'file:///in.mp4',
    output: 'file:///out.mp4',
    music: opts.music ?? null,
    category: opts.category ?? 'post',
  });
}

const at = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

test('an untouched clip needs no encoding at all', () => {
  assert.equal(plan().noop, true);
});

test('trimming seeks and limits the read, before the input', () => {
  const { args, noop } = plan({ trimStart: 10, trimEnd: 25 });
  assert.equal(noop, false);
  assert.equal(at(args, '-ss'), '10.000');
  assert.equal(at(args, '-t'), '15.000');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'seek must precede the input');
});

test('the encoder is told to read only the kept seconds', () => {
  // The whole point: a 60s clip cut to 10s must be decoded as 10s, not 60.
  const { args } = plan({ trimStart: 40, trimEnd: 50 });
  assert.equal(at(args, '-t'), '10.000');
});

test('speed changes picture and sound together', () => {
  const { args } = plan({ speed: 2 });
  assert.match(at(args, '-vf') ?? '', /setpts=PTS\/2/);
  assert.match(at(args, '-af') ?? '', /atempo=2/);
});

test('normal speed adds no tempo filter', () => {
  const { args } = plan({ speed: 1, filter: 'mono' });
  assert.doesNotMatch(at(args, '-af') ?? 'none', /atempo/);
});

test('a crop scales up then cuts to the exact shape', () => {
  const { args } = plan({ aspect: '9:16' });
  const vf = at(args, '-vf') ?? '';
  assert.match(vf, /scale=/);
  assert.match(vf, /crop=/);
  assert.ok(vf.indexOf('scale') < vf.indexOf('crop'), 'scale must come before crop');
});

test('the original shape is never cropped', () => {
  const vf = at(plan({ aspect: 'original', filter: 'vivid' }).args, '-vf') ?? '';
  assert.doesNotMatch(vf, /crop=/);
});

test('a filter becomes a real filter chain', () => {
  const vf = at(plan({ filter: 'mono' }).args, '-vf') ?? '';
  assert.match(vf, /hue=s=0/);
});

test('sliders map onto eq without drifting out of range', () => {
  const vf = at(plan({ brightness: 1, contrast: 1, saturation: 1 }).args, '-vf') ?? '';
  const eq = /eq=([^,]+)/.exec(vf)?.[1] ?? '';
  for (const part of eq.split(':')) {
    const [, value] = part.split('=');
    const n = Number(value);
    assert.ok(Number.isFinite(n), `${part} is not a number`);
    assert.ok(n >= -1 && n <= 2, `${part} outside eq's sane range`);
  }
});

test('muting the clip is expressed, not implied', () => {
  const { args } = plan({ clipVolume: 0 });
  assert.match(at(args, '-af') ?? '', /volume=0/);
});

test('music is mixed under the clip and the result is mapped', () => {
  const { args, steps } = plan({ music: null }, { music: 'file:///song.mp3' });
  assert.equal(args.filter((a) => a === '-i').length, 2, 'two inputs');
  assert.ok(args.join(' ').includes('amix=inputs=2'));
  assert.ok(args.includes('-map'), 'audio must be mapped explicitly when mixing');
  assert.ok(steps.some((s) => /sound/i.test(s)));
});

test('output is a fast-starting, widely playable mp4', () => {
  const { args } = plan({ filter: 'warm' });
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'), 'yuv420p is what phones and browsers both accept');
  assert.ok(args.join(' ').includes('+faststart'), 'so playback starts before the whole file lands');
  assert.equal(args.at(-1), 'file:///out.mp4');
});

test('short-lived categories are encoded smaller', () => {
  const vf = at(plan({ aspect: '9:16' }, { category: 'moment' }).args, '-vf') ?? '';
  assert.match(vf, /720/);
  const big = at(plan({ aspect: '9:16' }, { category: 'post' }).args, '-vf') ?? '';
  assert.match(big, /1080/);
});

test('every plan overwrites rather than asking', () => {
  for (const over of [{}, { speed: 2 }, { filter: 'noir' as const }, { aspect: '1:1' as const }]) {
    assert.equal(plan(over).args[0], '-y');
  }
});

/* ---------------------------------------------------------------- the cut */

/** The baked half, the way the encoder sees it: no captions, no stickers. */
function baked(over: Partial<VideoEdit> = {}) {
  const edit = { ...emptyEdit(SRC), ...over };
  const { captions: _c, stickers: _s, ...rest } = edit;
  return rest;
}

test('a clip that keeps its whole length has nothing to cut', () => {
  assert.equal(cutRange(baked()), null);
});

test('cutting a few frames off either end is not worth a re-mux', () => {
  assert.equal(cutRange(baked({ trimStart: 0.2, trimEnd: SRC - 0.2 })), null);
});

test('a real trim is reported in milliseconds', () => {
  assert.deepEqual(cutRange(baked({ trimStart: 10, trimEnd: 25 })), { startMs: 10_000, endMs: 25_000 });
});

test('a trim from the start keeps to the end of the source', () => {
  assert.deepEqual(cutRange(baked({ trimStart: 5 })), { startMs: 5_000, endMs: 60_000 });
});

test('a range is never empty, however short the kept part', () => {
  const cut = cutRange(baked({ trimEnd: 10.05 }));
  assert.ok(cut);
  assert.ok(cut.endMs - cut.startMs >= 100);
});

test('a plain cut is the only thing that needs no re-encode', () => {
  assert.equal(isTrimOnly(baked({ trimStart: 10, trimEnd: 25 })), true);
});

test('speed, filters, crop, light and music all need a re-encode', () => {
  assert.equal(isTrimOnly(baked({ speed: 2 })), false);
  assert.equal(isTrimOnly(baked({ filter: 'noir' })), false);
  assert.equal(isTrimOnly(baked({ aspect: '9:16' })), false);
  assert.equal(isTrimOnly(baked({ brightness: 0.2 })), false);
  assert.equal(isTrimOnly(baked({ contrast: 0.2 })), false);
  assert.equal(isTrimOnly(baked({ saturation: 0.2 })), false);
  assert.equal(isTrimOnly(baked({ clipVolume: 0 })), false);
  assert.equal(isTrimOnly(baked({ music: { id: 'a', label: 'A', uri: 'file:///a.m4a', volume: 0.6 } })), false);
});

test('a trimmed clip is what gets encoded, not just previewed', () => {
  // The whole point of the cut: the file that is uploaded is the shorter one.
  const cut = cutRange(baked({ trimStart: 10, trimEnd: 25 }));
  assert.ok(cut);
  assert.ok(cut.endMs - cut.startMs < SRC * 1000);
});
