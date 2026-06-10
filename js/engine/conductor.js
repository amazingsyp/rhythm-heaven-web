// conductor.js — single source of truth for game time.
// All game time derives from AudioContext.currentTime. Never judge with
// performance.now() or rAF timestamps: they drift from the audio hardware
// clock, and 30ms of drift changes a judgment grade.

const LOOKAHEAD = 0.100;      // seconds — schedule-ahead horizon
const TICK_MS = 25;           // scheduler interval

let audioCtx = null;
let musicGain = null;
let sfxGain = null;
let unlocked = false;

const bufferCache = new Map();

// ---------- context / gains ----------

export function getCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    musicGain = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    musicGain.connect(audioCtx.destination);
    sfxGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

export function getMusicGain() { getCtx(); return musicGain; }
export function getSfxGain() { getCtx(); return sfxGain; }

export function setMusicVolume(v) { getMusicGain().gain.value = v; }
export function setSfxVolume(v) { getSfxGain().gain.value = v; }

// ---------- iOS silent-switch workaround ("unmute" pattern) ----------
// Web Audio plays on the *ringer* channel on iOS, so the mute switch
// silences the speaker (Bluetooth routes ignore the switch — hence "works
// on AirPods, silent on speaker" reports). Looping a silent file through an
// HTMLAudioElement (NOT Web Audio) promotes the page's audio session to the
// media/playback category, which ignores the switch. Core idea from
// github.com/swevans/unmute; we use a real 0.5s silent mp3 (ffmpeg anullsrc)
// instead of a data URI — file decode is the more reliable path on iOS.
const SILENCE_URL = 'assets/audio/silence.mp3';
let silentEl = null;

function startMediaChannel() {
  // Must be called synchronously inside a user gesture.
  if (!silentEl) {
    silentEl = new Audio(SILENCE_URL);
    silentEl.loop = true;
    silentEl.setAttribute('playsinline', '');
    silentEl.preload = 'auto';
  }
  if (silentEl.paused) {
    silentEl.play().catch(() => { /* retried on the next gesture via unlock() */ });
  }
}

// Battery courtesy: stop the keepalive loop while backgrounded, resume on
// return. (An intentional gameplay pause keeps it running — the session
// category must survive pause menus, and the element is silent anyway.)
document.addEventListener('visibilitychange', () => {
  if (!silentEl) return;
  if (document.hidden) silentEl.pause();
  else if (unlocked) silentEl.play().catch(() => { /* next gesture retries */ });
});

/** Resume the context inside a user gesture (iOS audio unlock). */
export async function unlock() {
  startMediaChannel(); // before any await — needs the gesture call stack
  const ctx = getCtx();
  if (ctx.state !== 'running') {
    try { await ctx.resume(); } catch (e) { /* retried on next gesture */ }
  }
  if (!unlocked && ctx.state === 'running') {
    // Play a one-sample silent buffer — some iOS versions need an actual
    // source started inside the gesture before later starts are audible.
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    unlocked = true;
  }
  return unlocked;
}

export function isUnlocked() { return unlocked && audioCtx && audioCtx.state === 'running'; }

let userPaused = false; // intentional gameplay pause (suspend) in effect

/**
 * Playback-time safety net (QA #36): on touch, user activation is only
 * established at pointerup/click, so a pointerdown-time resume() can stay
 * pending. If the context is still suspended when we try to make sound,
 * retry resume — but never override an intentional gameplay pause.
 */
export function ensureRunning() {
  if (!userPaused && audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => { /* next gesture retries via unlock() */ });
  }
}

/** Current audio clock time. Read this inside input handlers, immediately. */
export function now() {
  return audioCtx ? audioCtx.currentTime : 0;
}

// ---------- buffer loading ----------

export async function loadBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const ctx = getCtx();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  const arr = await res.arrayBuffer();
  // Callback form wrapped in a promise: older iOS Safari lacks the
  // promise-returning decodeAudioData.
  const buf = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arr, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
  bufferCache.set(url, buf);
  return buf;
}

// ---------- lookahead scheduler ----------
// Queue of { time (ctx seconds), fn } fired ~100ms early so callbacks can
// schedule Web Audio events at exact absolute times (fn receives the time).

const queue = [];
let timer = null;

export function scheduleAt(ctxTime, fn) {
  queue.push({ time: ctxTime, fn });
  if (!timer) timer = setInterval(tick, TICK_MS);
}

export function clearSchedule() {
  queue.length = 0;
  if (timer) { clearInterval(timer); timer = null; }
}

function tick() {
  if (!audioCtx) return;
  const horizon = audioCtx.currentTime + LOOKAHEAD;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].time <= horizon) {
      const item = queue.splice(i, 1)[0];
      try { item.fn(Math.max(item.time, audioCtx.currentTime)); }
      catch (e) { console.error('scheduled fn failed', e); }
    }
  }
  if (queue.length === 0 && timer) { clearInterval(timer); timer = null; }
}

// ---------- calibration ----------

const CAL_KEY = 'vp-calibration';
let calibrationOffset = 0; // seconds; tap delay measured by the user

export function loadCalibration() {
  const v = parseFloat(localStorage.getItem(CAL_KEY));
  calibrationOffset = Number.isFinite(v) ? clampCal(v) : 0;
  return calibrationOffset;
}
export function getCalibration() { return calibrationOffset; }
export function setCalibration(sec) {
  calibrationOffset = clampCal(sec);
  try { localStorage.setItem(CAL_KEY, String(calibrationOffset)); } catch (e) { /* private mode */ }
  return calibrationOffset;
}
function clampCal(v) { return Math.min(0.2, Math.max(-0.2, v)); }

// ---------- song playback ----------

let song = null; // { startCtx, bpm, chartOffset, source, gain, ended }

/**
 * Start a song with a count-in aligned to the chart grid.
 * opts: { bpm, chartOffset=0, countInBeats=4, onCountBeat(i, ctxTime), musicLoop=false }
 * songTime 0 == the moment the music buffer starts playing; beat 0 is at
 * songTime == chartOffset. Count-in beeps land exactly on beats
 * -countInBeats .. -1, so beats (and songTime) are negative while counting.
 *
 * musicLoop: loop the music buffer (for short loop tracks shorter than the
 * chart). songTime/beat stay valid past the buffer length — they derive from
 * the linear AudioContext clock, not from buffer playback position.
 *
 * musicLoopBeats (with musicLoop): loop exactly this many beats of content
 * instead of the whole buffer. Decoded buffers usually carry encoder padding
 * at the tail (mp3: tens of ms), and whole-buffer looping drifts the music
 * off the chart grid by that padding on every pass. Setting the loop region
 * to an integer beat count keeps audio and chart locked forever.
 */
export function startSong(buffer, opts) {
  stopSong();
  ensureRunning();
  const ctx = getCtx();
  const {
    bpm, chartOffset = 0, countInBeats = 4, onCountBeat = null,
    musicLoop = false, musicLoopBeats = 0,
  } = opts;
  const beatDur = 60 / bpm;

  // Beat -countInBeats happens at songTime = chartOffset - countInBeats*beatDur.
  // If that is before the music starts (usual case), push the music start
  // far enough into the future that the first beep is schedulable.
  const firstBeepSongTime = chartOffset - countInBeats * beatDur;
  const lead = Math.max(0, -firstBeepSongTime) + 0.25;
  const musicStart = ctx.currentTime + lead;

  song = { startCtx: musicStart, bpm, chartOffset, source: null, gain: null, ended: false };

  for (let i = 0; i < countInBeats; i++) {
    const tCtx = musicStart + chartOffset + (i - countInBeats) * beatDur;
    scheduleAt(tCtx, (when) => { if (onCountBeat) onCountBeat(i, when); });
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = musicLoop; // looping never fires onended; the stage's `duration` ends the run
  if (musicLoop && musicLoopBeats > 0) {
    // Loop region must (a) be EXACTLY musicLoopBeats beats long and (b) wrap
    // to the buffer position of beat-0 content, which is chartOffset — NOT 0.
    // loopStart=0 would make the region (musicLoopBeats*beatDur + chartOffset)
    // long: chartOffset of drift per pass, and the intro replayed mid-loop.
    // With loopStart=chartOffset, the position at chart beat b (b >= loop) is
    // chartOffset + (b % musicLoopBeats)*beatDur — beat-exact on every pass.
    const loopEnd = chartOffset + musicLoopBeats * beatDur;
    if (loopEnd > buffer.duration + 1e-6) {
      console.warn(`musicLoopBeats: loop end ${loopEnd.toFixed(3)}s exceeds buffer ${buffer.duration.toFixed(3)}s — falling back to whole-buffer loop (check bpm/chartOffset/musicLoopBeats)`);
    } else {
      source.loopStart = chartOffset;
      source.loopEnd = loopEnd;
    }
  }
  // Per-song gain (between source and the shared musicGain) so a fade-out
  // never disturbs the user's music volume or the menu loop.
  const songGain = ctx.createGain();
  songGain.connect(musicGain);
  source.connect(songGain);
  source.start(musicStart);
  song.source = source;
  song.gain = songGain;
  source.onended = () => { if (song && song.source === source) song.ended = true; };
  return song;
}

/** Ramp the current song down over `sec` seconds (chart clock keeps running). */
export function fadeOutSong(sec = 0.8) {
  if (!song || !song.gain) return;
  const t = getCtx().currentTime;
  song.gain.gain.setValueAtTime(song.gain.gain.value, t);
  song.gain.gain.linearRampToValueAtTime(0.0001, t + sec);
}

export function stopSong() {
  if (song) {
    if (song.source) {
      try { song.source.onended = null; song.source.stop(); } catch (e) { /* already stopped */ }
    }
    song = null;
  }
  clearSchedule();
}

export function songActive() { return !!song; }
export function songEnded() { return !!(song && song.ended); }

/** songTime = audioCtx.currentTime - songStartTime - calibrationOffset */
export function songTime(ctxTime = now()) {
  if (!song) return 0;
  return ctxTime - song.startCtx - calibrationOffset;
}

export function songTimeToCtx(st) {
  if (!song) return now();
  return st + song.startCtx + calibrationOffset;
}

/**
 * Absolute ctx time of a chart beat for *audible playback* scheduling.
 * Deliberately excludes calibrationOffset: calibration shifts the judgment
 * reference (input latency compensation), not what the player hears.
 */
export function beatToCtx(beat) {
  if (!song) return now();
  return song.startCtx + song.chartOffset + beat * 60 / song.bpm;
}

export function timeToBeat(st) {
  if (!song) return 0;
  return (st - song.chartOffset) * song.bpm / 60;
}

export function beatToTime(beat) {
  if (!song) return 0;
  return song.chartOffset + beat * 60 / song.bpm;
}

export function currentBeat() { return timeToBeat(songTime()); }

// ---------- pause / resume ----------
// audioCtx.currentTime freezes while suspended, so songTime needs no
// extra bookkeeping across pauses.

export async function pause() {
  userPaused = true;
  if (audioCtx && audioCtx.state === 'running') await audioCtx.suspend();
}
export async function resume() {
  userPaused = false;
  if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
}
export function isPaused() { return !!(audioCtx && audioCtx.state === 'suspended'); }

// ---------- looping music (menus) ----------

let loopSource = null;

export function playLoop(buffer) {
  stopLoop();
  ensureRunning();
  const ctx = getCtx();
  loopSource = ctx.createBufferSource();
  loopSource.buffer = buffer;
  loopSource.loop = true;
  loopSource.connect(musicGain);
  loopSource.start();
}

export function stopLoop() {
  if (loopSource) {
    try { loopSource.stop(); } catch (e) { /* noop */ }
    loopSource = null;
  }
}
