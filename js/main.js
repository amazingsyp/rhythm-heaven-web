// main.js — Smooth Operator bootstrap and flow.
// Gate (audio unlock + sprite preload) → Title → Main chart (the 8-beat
// intro is the warm-up; there is no practice mode) → Result → Retry / Title.

import * as conductor from './engine/conductor.js';
import * as sfx from './engine/sfx.js';
import * as ui from './engine/ui.js';
import * as images from './engine/images.js';
import * as game from './game/veggie-pluck.js';
import { createInput } from './engine/input.js';
import { createRenderer } from './engine/renderer.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const MENU_MUSIC_URL = 'assets/audio/music/menu-coy-koi.mp3';

// ---------- boot ----------

const canvas = $('#game-canvas');
const renderer = createRenderer(canvas, $('#frame'));
conductor.loadCalibration();
loadVolumes();

// Decode + sprite preload starts immediately; an AudioContext may be created
// suspended and decodeAudioData works while suspended.
let assetsReady = false;
let gateTapped = false;
const preload = Promise.all([
  sfx.loadAll(),
  images.loadAll((done, total) => ui.setLoadProgress(done, total)),
  conductor.loadBuffer(game.MUSIC_URL),
  conductor.loadBuffer(MENU_MUSIC_URL).catch(() => null),
]).then(([, , musicBuf, menuBuf]) => {
  assetsReady = true;
  $('#gate-loading').classList.add('hidden');
  $('#gate-hint').classList.remove('hidden');
  return { musicBuf, menuBuf };
});
preload.catch((err) => {
  console.error('Preload failed:', err);
  $('#load-label').textContent = 'Loading failed — check your connection and reload.';
});

// ---------- run state ----------

let state = 'gate'; // gate | menu | playing | paused | result | calibrating
let menuMusicOn = false;

// ---------- gameplay input ----------

const input = createInput({
  target: canvas,
  onDown(ctxTime) {
    if (state !== 'playing') return;
    game.tap(conductor.songTime(ctxTime));
  },
  onUp() { /* no hold notes in the MVP chart (P7 is a later extension) */ },
});

// ---------- game lifecycle ----------

async function startGame() {
  stopMenuMusic();
  const { musicBuf } = await preload;
  state = 'playing';
  ui.showScreen('game');
  ui.showPause(false);
  game.start({ buffer: musicBuf });
  input.enable();
  renderer.start(frame);
}

function frame(dt) {
  const status = game.frame(renderer.ctx, dt);
  if (status === 'ended') endGame();
}

function endGame() {
  state = 'result';
  input.disable();
  renderer.stop();
  const summary = game.summary();
  game.stop();
  ui.saveBest(summary.rank);
  sfx.play(summary.rank === 'tryagain' ? 'fanfare-lose' : 'fanfare-win');
  ui.showResult(summary);
}

function quitGame() {
  input.disable();
  renderer.stop();
  game.stop();
  conductor.resume(); // in case we quit from pause
  goTitle();
}

// ---------- pause ----------

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  input.disable();
  renderer.stop();
  conductor.pause();
  ui.showPause(true);
}

function resumeGame() {
  if (state !== 'paused') return;
  ui.showPause(false);
  conductor.resume().then(() => {
    state = 'playing';
    input.enable();
    renderer.start(frame);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});

// ---------- menus ----------

function goTitle() {
  state = 'menu';
  ui.setTitleBest();
  ui.showScreen('title');
  ensureMenuMusic();
}

function ensureMenuMusic() {
  if (menuMusicOn) return;
  preload.then(({ menuBuf }) => {
    if (menuBuf && !menuMusicOn && (state === 'menu' || state === 'gate')) {
      conductor.playLoop(menuBuf);
      menuMusicOn = true;
    }
  });
}

function stopMenuMusic() {
  conductor.stopLoop();
  menuMusicOn = false;
}

// ---------- calibration ----------

const CAL_BPM = 90;
const CAL_TAPS_NEEDED = 8;
let cal = null; // { beepTimes: [], deltas: [] }

function startCalibration() {
  state = 'calibrating';
  ui.showScreen('calibrate');
  ui.setCalProgress(`Tap on every beep — 0 / ${CAL_TAPS_NEEDED}`);
  stopMenuMusic();

  const beatDur = 60 / CAL_BPM;
  const t0 = conductor.now() + 1.2;
  const beepTimes = [];
  for (let i = 0; i < CAL_TAPS_NEEDED + 4; i++) { // a few spares
    const t = t0 + i * beatDur;
    beepTimes.push(t);
    conductor.scheduleAt(t, (when) => sfx.play('count', when));
  }
  cal = { beepTimes, deltas: [] };
}

function calTap(ctxTime) {
  if (state !== 'calibrating' || !cal) return;
  ui.flashCalPad();
  let best = null;
  for (const bt of cal.beepTimes) {
    const d = ctxTime - bt;
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
  }
  if (best === null || Math.abs(best) > 0.3) return; // wild tap — ignore
  cal.deltas.push(best);
  ui.setCalProgress(`Tap on every beep — ${cal.deltas.length} / ${CAL_TAPS_NEEDED}`);
  if (cal.deltas.length >= CAL_TAPS_NEEDED) finishCalibration();
}

function finishCalibration() {
  const sorted = cal.deltas.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  conductor.setCalibration(median);
  cancelCalibration(true);
}

function cancelCalibration(done = false) {
  conductor.clearSchedule();
  cal = null;
  state = 'menu';
  ui.setCalibrationLabel(conductor.getCalibration());
  ui.showScreen('settings');
  if (done) sfx.play('fanfare-win');
}

$('#cal-pad').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  calTap(conductor.now());
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && state === 'calibrating') {
    e.preventDefault();
    calTap(conductor.now());
  }
});

// ---------- volume ----------

function loadVolumes() {
  const m = clamp01(parseFloat(localStorage.getItem('vp-vol-music')), 0.8);
  const s = clamp01(parseFloat(localStorage.getItem('vp-vol-sfx')), 0.9);
  conductor.setMusicVolume(m);
  conductor.setSfxVolume(s);
  $('#vol-music').value = Math.round(m * 100);
  $('#vol-sfx').value = Math.round(s * 100);
}
function clamp01(v, dflt) { return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt; }

$('#vol-music').addEventListener('input', (e) => {
  const v = e.target.value / 100;
  conductor.setMusicVolume(v);
  try { localStorage.setItem('vp-vol-music', String(v)); } catch (err) { /* noop */ }
});
$('#vol-sfx').addEventListener('input', (e) => {
  const v = e.target.value / 100;
  conductor.setSfxVolume(v);
  try { localStorage.setItem('vp-vol-sfx', String(v)); } catch (err) { /* noop */ }
});

// ---------- screen wiring ----------

// QA #36 (inherited): on touch, user activation is only established at
// pointerup/click — listen on 'click', never await the unlock, and let
// playback paths re-check the context state (conductor.ensureRunning).
$('#screen-gate').addEventListener('click', () => {
  conductor.unlock(); // fire-and-forget — must not block the transition
  if (gateTapped) return;
  gateTapped = true;
  state = 'menu';
  sfx.play('click');
  ui.setCalibrationLabel(conductor.getCalibration());
  const enter = () => {
    if (params.get('autoplay') === '1') startGame(); // QA shortcut
    else goTitle();
  };
  if (assetsReady) enter();
  else {
    $('#gate-hint').classList.add('hidden');
    $('#gate-loading').classList.remove('hidden');
    preload.then(enter);
  }
});

$('#btn-play').addEventListener('click', () => { sfx.play('click'); startGame(); });
$('#btn-settings').addEventListener('click', () => { sfx.play('click'); ui.showScreen('settings'); });
$('#btn-settings-back').addEventListener('click', () => { sfx.play('click'); goTitle(); });
$('#btn-calibrate').addEventListener('click', () => { sfx.play('click'); startCalibration(); });
$('#btn-cal-cancel').addEventListener('click', () => { sfx.play('click'); cancelCalibration(); });
$('#btn-cal-reset').addEventListener('click', () => {
  sfx.play('click');
  conductor.setCalibration(0);
  ui.setCalibrationLabel(0);
});

$('#btn-pause').addEventListener('pointerdown', (e) => { e.stopPropagation(); });
$('#btn-pause').addEventListener('click', () => { pauseGame(); });
$('#btn-resume').addEventListener('click', () => { sfx.play('click'); resumeGame(); });
$('#btn-quit').addEventListener('click', () => { sfx.play('click'); quitGame(); });

$('#btn-retry').addEventListener('click', () => {
  sfx.play('click');
  startGame();
});
$('#btn-result-title').addEventListener('click', () => { sfx.play('click'); goTitle(); });

// ---------- QA/debug hook ----------
// Lets the Playwright harness read the chart clock and land timed taps.
window.__vp = {
  debug: () => game.debugState(),
  missingSprites: () => images.missing.slice(),
};
