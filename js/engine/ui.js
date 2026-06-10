// ui.js — DOM shell screens for the single-game build: gate (audio unlock),
// loading, title, settings/calibration, gameplay overlays, result.
// Text UI stays in HTML (accessibility + less canvas work); only gameplay
// itself is canvas.

import { RANK_LABEL, RANK_VALUE } from './judge.js';
import { url as imgUrl } from './images.js';

const $ = (sel) => document.querySelector(sel);

const SCREENS = ['gate', 'title', 'settings', 'calibrate', 'game', 'result'];

export function showScreen(name) {
  for (const s of SCREENS) {
    $(`#screen-${s}`).classList.toggle('active', s === name);
  }
}

// ---------- best-rank bookkeeping ----------

const BEST_KEY = 'vp-best';

export function loadBest() {
  const v = localStorage.getItem(BEST_KEY);
  return RANK_VALUE[v] ? v : null;
}

export function saveBest(rank) {
  const prev = loadBest();
  if (!prev || RANK_VALUE[rank] > RANK_VALUE[prev]) {
    try { localStorage.setItem(BEST_KEY, rank); } catch (e) { /* private mode */ }
    return rank;
  }
  return prev;
}

export function setTitleBest() {
  const best = loadBest();
  const el = $('#title-best');
  el.textContent = best ? `Best: ${RANK_LABEL[best]}` : '';
  el.classList.toggle('hidden', !best);
}

// ---------- loading ----------

export function setLoadProgress(done, total) {
  $('#load-bar-fill').style.width = `${Math.round(done / total * 100)}%`;
  $('#load-label').textContent = `Loading sprites... ${done}/${total}`;
}

// ---------- gameplay overlays ----------

export function showPause(v) { $('#pause-overlay').classList.toggle('hidden', !v); }

// ---------- result (spec §1.5 / §4.2 — checkup-sheet concept) ----------

const STAMP = { perfect: 'result-star', superb: 'result-star', ok: 'result-ok', tryagain: 'result-x' };

const RESULT_MESSAGE = {
  perfect: 'Smooth operator indeed!',
  superb: 'Smooth operator indeed!',
  ok: 'Acceptably smooth. Ish.',
  tryagain: 'A follow-up appointment has been booked.',
};

const EPILOGUE = {
  perfect: '"Baby-smooth! The breeze feels incredible!"',
  superb: '"Baby-smooth! The breeze feels incredible!"',
  ok: '"It\'ll grow back by lunchtime anyway..."',
  tryagain: '"I can\'t show this chin in public!"',
};

export function showResult(summary) {
  const { rank, counts, total } = summary;
  $('#result-stamp').src = imgUrl(STAMP[rank]);
  const rankEl = $('#result-rank');
  rankEl.textContent = RANK_LABEL[rank];
  rankEl.className = `result-rank rank-${rank}`;
  $('#result-message').textContent = RESULT_MESSAGE[rank];
  $('#result-epilogue').textContent = EPILOGUE[rank];
  $('#result-counts').innerHTML =
    `<span>Ace ${counts.ace}</span><span>Barely ${counts.barely}</span>` +
    `<span>Miss ${counts.miss}</span><span>/ ${total}</span>`;
  showScreen('result');
}

// ---------- settings ----------

export function setCalibrationLabel(seconds) {
  $('#cal-value').textContent = Math.round(seconds * 1000);
}

export function setCalProgress(text) {
  $('#cal-progress').textContent = text;
}

export function flashCalPad() {
  const pad = $('#cal-pad');
  pad.classList.add('flash');
  setTimeout(() => pad.classList.remove('flash'), 90);
}
