import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EDIT_LIMITS,
  canEditAt,
  clipLength,
  clampEdit,
  editWindowClosesAt,
  cropTransform,
  emptyEdit,
  formatTime,
  gradeLayers,
  lookOf,
  hasCut,
  isEdited,
  liveWithCuts,
  overlaysAt,
  parseEdit,
  parseLiveEdit,
  piecesOf,
  playbackLength,
  removePiece,
  splitEdit,
  serializeEdit,
  setTrim,
  splitForUpload,
  toLiveEdit,
  looksNeutral,
  editFromLive,
} from './videoEdit';

const d = 60;

test('a fresh edit covers the whole clip and counts as untouched', () => {
  const e = emptyEdit(d);
  assert.equal(e.trimStart, 0);
  assert.equal(e.trimEnd, d);
  assert.equal(clipLength(e), d);
  assert.equal(isEdited(e), false);
});

test('every category is capped at the seconds its limit allows', () => {
  for (const [cat, limit] of Object.entries(EDIT_LIMITS)) {
    const e = setTrim(emptyEdit(600), 0, 600, cat as keyof typeof EDIT_LIMITS);
    assert.ok(clipLength(e) <= limit.maxSeconds + 0.001, `${cat} exceeds its cap`);
    assert.ok(limit.maxSeconds > 0);
  }
});

test('a Moment clip runs up to 25 seconds, never longer', () => {
  const e = clampEdit({ ...emptyEdit(300), trimEnd: 300 }, 'moment');
  assert.equal(EDIT_LIMITS.moment.maxSeconds, 25);
  assert.ok(clipLength(e) <= 25.001);
});

test('a Moment edited under the old minute limit is cut back to 25', () => {
  // Somebody can still have a 60-second Moment edit sitting in a saved draft from
  // before the limit changed. It is clamped on the way out, not silently posted.
  const long = clampEdit({ ...emptyEdit(90), trimEnd: 58 }, 'moment');
  assert.ok(clipLength(long) <= 25.001, `got ${clipLength(long)}`);
});

test('trimming drags overlays back inside the window', () => {
  let e = emptyEdit(d);
  e = emptyEdit(d);
  e = {
    ...e,
    captions: [
      {
        id: 'c1', text: 'hi', x: 0.5, y: 0.5, start: 50, end: 59,
        size: 0.06, color: '#fff', style: 'none' as const, animation: 'none' as const, bold: true,
      },
    ],
  };
  const trimmed = setTrim(e, 0, 10, 'moment');
  const c = trimmed.captions[0];
  assert.ok(c.end <= 10.001, `caption end ${c.end} should follow the trim`);
});

test('speed shortens what you watch but not what is stored', () => {
  const e = { ...emptyEdit(d), speed: 2 };
  assert.equal(clipLength(e), d);
  assert.equal(playbackLength(e), 30);
});

test('overlays only appear inside their own span', () => {
  const e = {
    ...emptyEdit(d),
    captions: [
      {
        id: 'c1', text: 'hi', x: 0.5, y: 0.5, start: 2, end: 5,
        size: 0.06, color: '#fff', style: 'none' as const, animation: 'none' as const, bold: true,
      },
    ],
  };
  assert.equal(overlaysAt(e, 1).captions.length, 0);
  assert.equal(overlaysAt(e, 3).captions.length, 1);
  assert.equal(overlaysAt(e, 5).captions.length, 0, 'the end is exclusive');
});

test('the split keeps words live and sends the rest to the encoder', () => {
  const e = {
    ...emptyEdit(d),
    trimStart: 5,
    trimEnd: 20,
    speed: 1.5,
    captions: [
      {
        id: 'c1', text: 'hello', x: 0.5, y: 0.5, start: 0, end: 5,
        size: 0.06, color: '#fff', style: 'box' as const, animation: 'fade' as const, bold: true,
      },
    ],
    stickers: [
      { id: 's1', glyph: '🔥', x: 0.3, y: 0.3, start: 0, end: 5, scale: 1, rotation: 0 },
    ],
  };
  const { baked, live } = splitForUpload(e, 'moment');
  assert.equal(baked.trimStart, 5);
  assert.equal(baked.speed, 1.5);
  assert.equal((baked as { captions?: unknown }).captions, undefined, 'captions must not be baked');
  assert.equal((baked as { stickers?: unknown }).stickers, undefined, 'stickers must not be baked');
  assert.equal(live?.captions.length, 1);
  assert.equal(live?.stickers.length, 1);
});

test('an untouched clip stores nothing', () => {
  const { live } = splitForUpload(emptyEdit(d), 'post');
  assert.equal(live, null);
});

test('an edit survives a round trip, and a broken one opens anyway', () => {
  const e = { ...emptyEdit(d), speed: 0.5, filter: 'noir' as const };
  const back = parseEdit(serializeEdit(e));
  assert.equal(back?.speed, 0.5);
  assert.equal(back?.filter, 'noir');
  assert.equal(parseEdit('not json'), null);
  assert.equal(parseEdit(null), null);
  assert.equal(parseEdit('{"nope":1}'), null);
});

test('a live half saved by an older build still opens', () => {
  assert.deepEqual(parseLiveEdit('{"version":1}')?.captions, []);
  assert.deepEqual(parseLiveEdit('{"version":1}')?.stickers, []);
  assert.equal(parseLiveEdit('garbage'), null);
});

test('the edit window is fifteen minutes and then shuts', () => {
  const posted = 1_000_000;
  assert.equal(editWindowClosesAt(posted) - posted, 15 * 60 * 1000);
  assert.equal(canEditAt(posted, posted + 14 * 60 * 1000), true);
  assert.equal(canEditAt(posted, posted + 16 * 60 * 1000), false);
  assert.equal(canEditAt(posted, posted), true, 'the moment of posting is inside');
});

test('formatting reads the way a clock does', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(75.5), '1:15.50');
});

test('toLiveEdit carries the words and the look, never the cut', () => {
  const e = { ...emptyEdit(d), speed: 2, filter: 'noir' as const, trimStart: 5, captions: [] as never[] };
  const live = toLiveEdit(e as never);

  // The look travels, because the player is what applies it.
  assert.equal(live.look.speed, 2);
  assert.equal(live.look.filter, 'noir');

  // The cut does not: it has already been applied to the file itself.
  assert.equal((live as { trimStart?: unknown }).trimStart, undefined);
  assert.equal(live.version, 2);
});

test('an untouched clip has a neutral look and sends nothing', () => {
  const live = toLiveEdit(emptyEdit(d) as never);
  assert.equal(looksNeutral(live.look), true);
  assert.equal(splitForUpload(emptyEdit(d), 'post').live, null);
});

test('a look alone is worth sending, with no words on it', () => {
  const edit = { ...emptyEdit(d), filter: 'mono' as const };
  const live = splitForUpload(edit, 'post').live;
  assert.ok(live);
  assert.equal(live.captions.length, 0);
  assert.equal(live.look.filter, 'mono');
});

test('a clip stored before the look travelled plays back untouched', () => {
  const live = parseLiveEdit('{"version":1,"captions":[],"stickers":[]}');
  assert.ok(live);
  assert.equal(looksNeutral(live.look), true);
});

test('a look comes back out of storage the way it went in', () => {
  const look = { filter: 'sunset' as const, brightness: 0.25, contrast: -0.1, saturation: 0.4, aspect: '1:1' as const, speed: 1.5, clipVolume: 0, music: null };
  const live = parseLiveEdit(JSON.stringify({ version: 2, captions: [], stickers: [], look }));
  // Written before the six knobs existed: what it says is kept, and the new
  // knobs arrive at neutral rather than as `undefined` the player would have to
  // guard against on every frame.
  assert.deepEqual(live?.look, { ...look, warmth: 0, tint: 0, fade: 0, vignette: 0, grain: 0, cropZoom: 1, cropX: 0, cropY: 0 });
});

test('reopening a posted clip does not reset how it looks', () => {
  const look = { filter: 'noir' as const, brightness: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, fade: 0, vignette: 0, grain: 0, aspect: 'original' as const, cropZoom: 1, cropX: 0, cropY: 0, speed: 2, clipVolume: 1, music: null };
  const reopened = editFromLive({ version: 2, captions: [], stickers: [], look }, d);
  assert.equal(reopened.filter, 'noir');
  assert.equal(reopened.speed, 2);
});

/* ------------------------------------ a cut that could not be baked into a file
 *
 * When there is no encoder, the file is uploaded whole — every frame of it,
 * including the ones that were cut away. The cut then has to travel as data or
 * the edit is lost for everybody watching. These pin that path down.
 */

test('a timeline that cuts nothing carries no cuts', () => {
  assert.equal(hasCut(emptyEdit(30)), false);
});

test('a trim at either end counts as a cut', () => {
  assert.equal(hasCut(clampEdit({ ...emptyEdit(30), trimStart: 4 }, 'post')), true);
  assert.equal(hasCut(clampEdit({ ...emptyEdit(30), trimEnd: 20 }, 'post')), true);
});

test('a hole in the middle counts as a cut', () => {
  const split = splitEdit(emptyEdit(30), 8, 'post');
  assert.equal(piecesOf(split).length, 2);
  assert.equal(hasCut(split), false, 'a split that removed nothing is not a cut');

  const withHole = removePiece(split, piecesOf(split)[0].id, 'post');
  assert.equal(hasCut(withHole), true);
});

test('an uncut clip keeps its live half exactly as it was', () => {
  const live = toLiveEdit(emptyEdit(30));
  assert.equal(liveWithCuts(live, emptyEdit(30)), live);
});

test('a cut clip that was not encoded carries its pieces', () => {
  const edit = clampEdit({ ...emptyEdit(30), trimStart: 5, trimEnd: 20 }, 'post');
  const live = liveWithCuts(null, edit);
  assert.ok(live, 'a clip with nothing else to keep still needs a live half for the cut');
  assert.equal(live?.cuts?.length, 1);
  assert.deepEqual(live?.cuts?.map((c) => [c.start, c.end]), [[5, 20]]);
  // Nothing else changed: the look is the untouched look.
  assert.equal(live?.look.filter, 'none');
});

test('the cut survives being written down and read back', () => {
  const edit = clampEdit({ ...emptyEdit(30), trimStart: 5, trimEnd: 20 }, 'post');
  const live = liveWithCuts(null, edit)!;
  const back = parseLiveEdit(JSON.stringify(live));
  assert.deepEqual(back?.cuts?.map((c) => [c.start, c.end]), [[5, 20]]);
});

test('a stored clip with no cuts reads as no cuts', () => {
  const back = parseLiveEdit(JSON.stringify({ version: 2, captions: [], stickers: [], look: {} }));
  assert.equal(back?.cuts, undefined);
});

/*
 * The trim buttons.
 *
 * "Use everything", "First Ns" and "Last 5s" were reported as dead: only the
 * last one appeared to do anything. It was not the buttons. Every one of them
 * wrote the new timeline but left the previous trim window in place, and
 * `clampEdit` — which exists so that old edits that only set a window still
 * open correctly — believes a window that disagrees with a whole-file timeline.
 * So after a trim, "Use everything" was quietly undone and the clip snapped
 * back to five seconds.
 */
test('use everything restores a clip that was trimmed to its tail', () => {
  const total = 40;
  const start = emptyEdit(total);
  const tail = setTrim(start, total - 5, total, 'post');
  assert.equal(clipLength(tail), 5);

  const everything = setTrim(tail, 0, total, 'post');
  assert.equal(clipLength(everything), total);
  assert.equal(everything.trimStart, 0);
  assert.equal(everything.trimEnd, total);
});

test('use everything also restores a clip trimmed to its head', () => {
  const total = 40;
  const head = setTrim(emptyEdit(total), 0, 12, 'post');
  assert.equal(clipLength(head), 12);
  const everything = setTrim(head, 0, total, 'post');
  assert.equal(clipLength(everything), total);
});

test('the trim window always agrees with the pieces after a trim', () => {
  const total = 40;
  for (const [s, e] of [[0, 10], [5, 30], [30, 40], [12, 13]] as const) {
    const edit = setTrim(emptyEdit(total), s, e, 'post');
    assert.equal(edit.trimStart, edit.segments[0].start, `start after ${s}-${e}`);
    assert.equal(edit.trimEnd, edit.segments[edit.segments.length - 1].end, `end after ${s}-${e}`);
  }
});

test('a second trim never inherits the first one\'s window', () => {
  const total = 40;
  const first = setTrim(emptyEdit(total), 30, 35, 'post');
  const second = setTrim(first, 2, 8, 'post');
  assert.equal(second.trimStart, 2);
  assert.equal(second.trimEnd, 8);
  assert.equal(clipLength(second), 6);
});

test('every button lands on the length the category allows', () => {
  // 90 seconds of source, a minute allowed: "use everything" keeps the first
  // minute rather than refusing, and the cap is what makes it a minute.
  const big = setTrim(emptyEdit(90), 0, 90, 'post');
  assert.equal(clipLength(big), EDIT_LIMITS.post.maxSeconds);
  const moment = setTrim(emptyEdit(90), 0, 90, 'moment');
  assert.equal(clipLength(moment), EDIT_LIMITS.moment.maxSeconds);
});

/*
 * The six knobs.
 *
 * They are drawn by the player as veils and two amounts, so the shape of this
 * output *is* the preview: if a value stops producing a layer, the knob goes
 * dead without any error, and if it produces the wrong colour the clip drifts.
 */
test('a neutral grade draws nothing at all', () => {
  const grade = gradeLayers(emptyEdit(10));
  assert.deepEqual(grade.veils, []);
  assert.equal(grade.vignette, 0);
  assert.equal(grade.grain, 0);
});

test('brightness lifts with white and dims with black', () => {
  const up = gradeLayers({ ...emptyEdit(10), brightness: 0.5 });
  assert.deepEqual(up.veils, [{ color: '#ffffff', opacity: 0.5 * 0.28 }]);
  const down = gradeLayers({ ...emptyEdit(10), brightness: -0.5 });
  assert.deepEqual(down.veils, [{ color: '#000000', opacity: 0.5 * 0.34 }]);
});

test('warmth and tint move in opposite directions', () => {
  const warm = gradeLayers({ ...emptyEdit(10), warmth: 1 });
  assert.equal(warm.veils[0].color, '#ff9a3c');
  const cool = gradeLayers({ ...emptyEdit(10), warmth: -1 });
  assert.equal(cool.veils[0].color, '#3ca8ff');
  const magenta = gradeLayers({ ...emptyEdit(10), tint: 1 });
  assert.equal(magenta.veils[0].color, '#ff4fa3');
  const green = gradeLayers({ ...emptyEdit(10), tint: -1 });
  assert.equal(green.veils[0].color, '#2ee6a8');
});

test('the veils are always stacked in the same order', () => {
  const grade = gradeLayers({ ...emptyEdit(10), brightness: 0.4, warmth: 0.6, tint: -0.3, fade: 0.5 });
  assert.deepEqual(grade.veils.map((v) => v.color), ['#ffffff', '#ff9a3c', '#2ee6a8', '#f6efe6']);
});

test('vignette and grain pass through, and are clamped to 0..1', () => {
  const grade = gradeLayers({ ...emptyEdit(10), vignette: 0.6, grain: 0.4 });
  assert.equal(grade.vignette, 0.6);
  assert.equal(grade.grain, 0.4);
  const clamped = gradeLayers({ ...emptyEdit(10), vignette: 4, grain: -2 });
  assert.equal(clamped.vignette, 1);
  assert.equal(clamped.grain, 0);
});

test('a crop is a zoom and an offset the player can apply', () => {
  assert.deepEqual(cropTransform(emptyEdit(10)), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(cropTransform({ ...emptyEdit(10), cropZoom: 2, cropX: -0.5, cropY: 0.25 }), {
    scale: 2,
    x: -0.5,
    y: 0.25,
  });
  // Out-of-range values are held at the edges rather than thrown away.
  assert.deepEqual(cropTransform({ ...emptyEdit(10), cropZoom: 9, cropX: -4, cropY: 4 }), {
    scale: 3,
    x: -1,
    y: 1,
  });
});

test('the six knobs travel with the clip, so a grade set on a phone posts', () => {
  const edit = { ...emptyEdit(12), warmth: 0.4, vignette: 0.3, grain: 0.2 };
  const live = JSON.parse(serializeEdit(edit));
  const back = parseLiveEdit(JSON.stringify({ version: 2, captions: [], stickers: [], look: lookOf(edit) }));
  assert.equal(back?.look.warmth, 0.4);
  assert.equal(back?.look.vignette, 0.3);
  assert.equal(back?.look.grain, 0.2);
  assert.ok(live);
});
