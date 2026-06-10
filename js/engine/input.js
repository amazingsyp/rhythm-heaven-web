// input.js — pointer (touch + mouse) and Space key merged into one handler.
// The judgment timestamp is read from audioCtx.currentTime *inside* the
// handler — waiting for the next rAF frame would add up to 16ms of error,
// and event.timeStamp lives on a different clock than the audio context.

import { now, unlock } from './conductor.js';

/**
 * createInput({ target, onDown, onUp })
 *   target — element receiving pointerdown (usually the game canvas)
 *   onDown(ctxTime, e), onUp(ctxTime, e)
 * Space keydown/keyup (window-level) routes to the same handlers.
 * Returns { enable, disable, destroy, isDown }.
 */
export function createInput({ target, onDown, onUp }) {
  let enabled = false;
  let pointerHeld = false;
  let spaceHeld = false;

  const down = (e) => {
    const t = now(); // read the audio clock first, before anything else
    unlock();        // any gesture keeps the context unlocked (iOS)
    if (e.cancelable) e.preventDefault();
    if (!enabled) return;
    if (onDown) onDown(t, e);
  };
  const up = (e) => {
    const t = now();
    if (!enabled) return;
    if (onUp) onUp(t, e);
  };

  const onPointerDown = (e) => { pointerHeld = true; down(e); };
  const onPointerUp = (e) => {
    if (!pointerHeld) return;
    pointerHeld = false;
    if (!spaceHeld) up(e);
  };
  const onKeyDown = (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    e.preventDefault(); // stop page scroll / button re-activation
    spaceHeld = true;
    down(e);
  };
  const onKeyUp = (e) => {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    if (!pointerHeld) up(e);
  };

  target.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    enable() { enabled = true; },
    disable() { enabled = false; pointerHeld = false; spaceHeld = false; },
    isDown() { return pointerHeld || spaceHeld; },
    destroy() {
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
