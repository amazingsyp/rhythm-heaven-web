// sfx.js — sound effect loading, playback, and beat scheduling.
// Files are Ogg Vorbis (Kenney.nl, CC0). Safari (macOS + iOS) cannot decode
// Ogg, and mobile networks can drop files — so every named SFX has a Web
// Audio oscillator synth fallback. The game never goes silent.

import { getCtx, getSfxGain, loadBuffer, scheduleAt, songTimeToCtx, beatToCtx, now, ensureRunning } from './conductor.js';

// Registered names (the engine + stages refer to SFX only by these names).
const FILES = {
  'hit':          ['assets/audio/sfx/hit-01.ogg', 'assets/audio/sfx/hit-02.ogg', 'assets/audio/sfx/hit-03.ogg'],
  'miss':         ['assets/audio/sfx/miss.ogg'],
  'barely':       ['assets/audio/sfx/barely.ogg'],
  'count':        ['assets/audio/sfx/countin-beep.ogg'],
  'fanfare-win':  ['assets/audio/sfx/result-success.ogg'],
  'fanfare-lose': ['assets/audio/sfx/result-fail.ogg'],
  'click':        ['assets/audio/sfx/menu-click.ogg'],
};

// Synth recipes: [{ wave, from(Hz), to(Hz), dur(s), delay(s), vol }]
// Each entry is one oscillator voice; multiple entries = tiny jingle.
const SYNTH = {
  'hit':          [{ wave: 'square', from: 950, to: 1500, dur: 0.07, vol: 0.30 }],
  'barely':       [{ wave: 'triangle', from: 600, to: 420, dur: 0.10, vol: 0.35 },
                   { wave: 'triangle', from: 420, to: 560, dur: 0.12, delay: 0.10, vol: 0.30 }],
  'miss':         [{ wave: 'sawtooth', from: 380, to: 110, dur: 0.40, vol: 0.30 }],
  'count':        [{ wave: 'sine', from: 1000, to: 1000, dur: 0.08, vol: 0.45 }],
  'fanfare-win':  [{ wave: 'square', from: 523, to: 523, dur: 0.16, vol: 0.25 },
                   { wave: 'square', from: 659, to: 659, dur: 0.16, delay: 0.16, vol: 0.25 },
                   { wave: 'square', from: 784, to: 784, dur: 0.34, delay: 0.32, vol: 0.28 }],
  'fanfare-lose': [{ wave: 'square', from: 392, to: 392, dur: 0.20, vol: 0.25 },
                   { wave: 'square', from: 330, to: 330, dur: 0.20, delay: 0.22, vol: 0.25 },
                   { wave: 'square', from: 247, to: 240, dur: 0.45, delay: 0.44, vol: 0.28 }],
  'click':        [{ wave: 'sine', from: 1800, to: 1400, dur: 0.045, vol: 0.30 }],
};

const buffers = new Map(); // name -> AudioBuffer[]

/** Load every SFX file; failures fall back to synth silently. */
export async function loadAll() {
  const jobs = [];
  for (const [name, urls] of Object.entries(FILES)) {
    jobs.push((async () => {
      const decoded = [];
      for (const url of urls) {
        try { decoded.push(await loadBuffer(url)); }
        catch (e) { /* Ogg unsupported (Safari) or fetch failed — synth fallback */ }
      }
      if (decoded.length) buffers.set(name, decoded);
    })());
  }
  await Promise.all(jobs);
  return [...buffers.keys()];
}

export function hasFile(name) { return buffers.has(name); }

/**
 * Play a named SFX.
 * `whenCtx` is an absolute AudioContext time (default: immediately).
 * opts: { rate = 1 (playbackRate — the "do-re-mi" count voice uses
 *         1.0 / 1.122 / 1.26), gain = 1 (relative to the SFX bus) }
 */
export function play(name, whenCtx = 0, opts = null) {
  ensureRunning(); // QA #36: retry a pending resume at playback time
  const ctx = getCtx();
  const t = Math.max(whenCtx, ctx.currentTime);
  const rate = (opts && opts.rate) || 1;
  const vol = (opts && opts.gain !== undefined) ? opts.gain : 1;
  const variants = buffers.get(name);
  if (variants) {
    const buf = variants[(Math.random() * variants.length) | 0];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (vol !== 1) {
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(getSfxGain());
    } else {
      src.connect(getSfxGain());
    }
    src.start(t);
    return;
  }
  synth(name, t, rate, vol);
}

/** Play at a songTime (seconds into the song). */
export function playAtSongTime(name, st, opts = null) {
  play(name, songTimeToCtx(st), opts);
}

/**
 * Reserve a named SFX on a chart beat via the lookahead scheduler
 * (25ms tick / 100ms horizon), then start at the exact absolute time.
 */
export function scheduleOnBeat(name, beat, opts = null) {
  const ctxTime = beatToCtx(beat);
  if (ctxTime - now() <= 0.15) {
    play(name, ctxTime, opts); // too close for the scheduler — start directly
  } else {
    scheduleAt(ctxTime, (when) => play(name, when, opts));
  }
}

/**
 * "Boing" hair-growth synth (spec §5.2 recipe: sine 200→600Hz pitch slide
 * over 80ms + short decay; no boing in the Kenney set, so always synthesized).
 * `pitchMul` rises +10% per hair in a fast cluster.
 * Gain 0.18 (was 0.42): it is a guide cue and must sit under the BGM.
 */
export function boing(whenCtx = 0, pitchMul = 1) {
  ensureRunning();
  const ctx = getCtx();
  const t = Math.max(whenCtx, ctx.currentTime);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200 * pitchMul, t);
  osc.frequency.exponentialRampToValueAtTime(600 * pitchMul, t + 0.08);
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
  osc.connect(g);
  g.connect(getSfxGain());
  osc.start(t);
  osc.stop(t + 0.22);
}

function synth(name, t, rate = 1, vol = 1) {
  const ctx = getCtx();
  const recipe = SYNTH[name];
  if (!recipe) return;
  for (const v of recipe) {
    const start = t + (v.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = v.wave;
    osc.frequency.setValueAtTime(v.from * rate, start);
    if (v.to !== v.from) osc.frequency.exponentialRampToValueAtTime(Math.max(v.to * rate, 1), start + v.dur);
    gain.gain.setValueAtTime(v.vol * vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + v.dur);
    osc.connect(gain);
    gain.connect(getSfxGain());
    osc.start(start);
    osc.stop(start + v.dur + 0.02);
  }
}

export const NAMES = Object.keys(FILES);
