import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerPlayer,
  takeFocus,
  releaseFocus,
  hasFocus,
  __resetPlayerFocus,
} from './playerFocus';

function makePlayer() {
  const state = { paused: 0 };
  return {
    state,
    pause() {
      state.paused += 1;
    },
  };
}

beforeEach(() => __resetPlayerFocus());

test('the first player to claim focus is the one that holds it', () => {
  const a = makePlayer();
  takeFocus(a);
  assert.equal(hasFocus(a), true);
  assert.equal(a.state.paused, 0);
});

test('claiming focus pauses every other registered player', () => {
  const a = makePlayer();
  const b = makePlayer();
  const c = makePlayer();
  registerPlayer(a);
  registerPlayer(b);
  registerPlayer(c);

  takeFocus(a);
  const pausedAsBystander = b.state.paused;
  takeFocus(b);

  assert.equal(hasFocus(a), false);
  assert.equal(hasFocus(b), true);
  // Pausing an idle clip is a no-op, so the registry does not track who is
  // currently playing — it silences everyone on every ownership change. The
  // invariant that matters is that a loser is always told to stop.
  assert.ok(a.state.paused >= 1, 'the previous holder is told to stop');
  assert.ok(c.state.paused >= 1, 'a bystander that may be playing is told to stop');
  assert.equal(b.state.paused, pausedAsBystander, 'the winner is never paused by its own claim');
});

test('a player that already holds focus does not pause itself', () => {
  const a = makePlayer();
  const b = makePlayer();
  registerPlayer(a);
  registerPlayer(b);

  takeFocus(a);
  takeFocus(a);

  assert.equal(a.state.paused, 0);
  assert.equal(b.state.paused, 1, 'the loser is only paused once');
});

test('an unregistered player is no longer silenced', () => {
  const a = makePlayer();
  const b = makePlayer();
  const c = makePlayer();
  const unregisterB = registerPlayer(b);
  registerPlayer(a);
  registerPlayer(c);

  takeFocus(a);
  const pausedWhileRegistered = b.state.paused;
  assert.ok(pausedWhileRegistered >= 1);

  unregisterB();
  takeFocus(c);
  assert.equal(b.state.paused, pausedWhileRegistered, 'the dead player is left alone');
});

test('unmounting the active player frees the sound instead of stranding it', () => {
  const a = makePlayer();
  const unregister = registerPlayer(a);
  takeFocus(a);
  assert.equal(hasFocus(a), true);

  unregister();
  assert.equal(hasFocus(a), false);
});

test('releasing focus hands the sound to nobody', () => {
  const a = makePlayer();
  registerPlayer(a);

  takeFocus(a);
  releaseFocus(a);

  assert.equal(hasFocus(a), false);
});

test('releasing a player that never had focus leaves the holder alone', () => {
  const a = makePlayer();
  const b = makePlayer();
  registerPlayer(a);
  registerPlayer(b);

  takeFocus(a);
  releaseFocus(b);

  assert.equal(hasFocus(a), true);
});
