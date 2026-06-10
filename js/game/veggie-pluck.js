// veggie-pluck.js — "Smooth Operator": the whole game, 15-customer chart.
// (filename kept from the veggie build; the cast is now two gentlemen whose
// chin stubble grows in rhythm and must be plucked from below.)
//
// Call & response echo (spec §1.1): beard hairs grow in a rhythm during the
// call measure; tweezers sweep the chin during the response measure and reach
// each hair exactly at pluckBeat = growBeat + 4. The hair's x position IS
// the timeline: hairs sit on the chin arc by growBeat, the tweezers sweep
// that arc at constant speed, so cue geometry and timing always agree.
//
// Judging is the engine's (JudgeSession) — never reimplemented here.
// All characters/props are generated PNG sprites (engine/images.js);
// code only transforms them (scale/rotate/translate).

import * as conductor from '../engine/conductor.js';
import * as sfx from '../engine/sfx.js';
import { JudgeSession } from '../engine/judge.js';
import { get as img } from '../engine/images.js';
import { W, H } from '../engine/renderer.js';

// ---------- measured music data (qa-scripts, 2026-06-10) ----------
// bpm-sweep: 105.00 (score 35.1, runner-up 18.1) — manifest's ~103 was wrong.
// offset-probe @105/0.484: diff +0ms, confidence 11.21, PASS.
export const MUSIC_URL = 'assets/audio/music/stage05-silly-boy.mp3';
export const BPM = 105.0;
export const CHART_OFFSET = 0.484;

// ---------- chart v2 (spec §1.3 + pattern research, build notes §v2) ----------
// Pattern offsets are growBeat-1 (0-based position inside the call measure).
// Research anchors:
//  - WarioWare Gold L2: "six hairs, all intervals the same length except one"
//    → P10. L3: "five hairs with varied intervals" → P11. (mariowiki, verified)
//  - GBA RT2 skill star: "one hair on either side and five hairs in between"
//    → P15 finale. (rhythmheaven.fandom.com, verified)
//  - JP sources: 16th-note hairs appear near the end → 16th 3-bursts (P9/P13/P14).
//  - Megamix 9th-veg star "two spaced + two close" → P6 (kept).
// Max grow offset is 3.0 so the latest pluck (offset+4 = beat 7) lands before
// the slide-out at beat 7.25 — every hair is plucked on a centered face.
const PATTERNS = {
  P1:  [0],                                // single + count voice
  P2:  [0, 2],                             // spaced double
  P3:  [0, 1, 2],                          // on-beat triple
  P4:  [0, 1, 2, 3],                       // on-beat quad
  P5:  [0, 0.5, 1],                        // fast triple (8ths)
  P6:  [0, 1.5, 2, 2.5],                   // spaced + cluster (Megamix star)
  P7:  [0.5, 1.5, 2.5],                    // offbeat triple (all on the "and")
  P8:  [0, 0.5, 1, 1.5, 2],                // 8th-note run of 5
  P9:  [0, 1, 2, 2.25, 2.5],               // spaced lead-in → 16th 3-burst
  P10: [0, 0.5, 1, 2, 2.5, 3],             // 6 hairs, equal 8ths + one gap (WW Gold L2)
  P11: [0, 0.75, 1.5, 2, 3],               // 5 hairs, uneven intervals (WW Gold L3)
  P12: [0.5, 1, 1.5, 2, 2.5],              // offbeat-start 8th run of 5
  P13: [0, 0.25, 0.5, 2, 2.25, 2.5],       // two 16th 3-bursts
  P14: [0, 0.5, 1, 1.5, 2, 2.25, 2.5],     // 8th run flowing into a 16th burst
  P15: [0, 1, 1.5, 1.75, 2, 2.5, 3],       // GBA star: edge singles + packed centre
};
// [face, pattern] per customer. Only cycles 1-2 are P1/P2 (no practice mode —
// the 8-beat intro is the warm-up), then difficulty climbs fast; the last two
// cycles are the maximum-density combos. #9 (index 8) is the bonus-star spot.
const CHART = [
  ['a', 'P1'],  ['a', 'P2'],  ['b', 'P3'],  ['a', 'P5'],
  ['b', 'P7'],  ['a', 'P4'],  ['b', 'P6'],  ['a', 'P8'],
  ['b', 'P10'], ['a', 'P9'],  ['b', 'P11'], ['a', 'P12'],
  ['b', 'P13'], ['a', 'P14'], ['b', 'P15'],
];
const INTRO = 8;        // beats of BGM before customer 1 (rod only) — the warm-up
const CYCLE = 8;        // beats per customer
const OUTRO = 4;        // beats after the last cycle
const END_BEAT = INTRO + CHART.length * CYCLE + OUTRO; // 132
const ECHO = 4;         // pluckBeat = growBeat + ECHO
const BONUS_CYCLE = 8;  // index of the Skill-Star homage customer

// ---------- layout (spec §2 mirrored to the chin, 480x720 portrait) ----------
const FACE_CX = W / 2;
const FACE_CY = H * 0.50;             // raised vs the veggie build: the beard
                                      // arc + tweezers need room below the chin
const FACE_R = (H * 0.38) / 2 * 0.88;
const ROD_Y = FACE_CY;                // skewer rod runs behind the heads
const ROD_H = H * 0.030;
const HAIR_LEN = FACE_R * 0.55;       // visible strand length on screen
const ARC_L = 210, ARC_R = 330;       // beard arc, degrees: lower-left → lower-right
const ARC_SPAN = ARC_R - ARC_L;       // 120
const SLIDE_X = W * 0.95;             // off-screen slide distance

// Measured sprite metrics (alpha bboxes via qa-scripts/measure-sprites.mjs).
// Pose frames carry very different padding (and the happy poses add sparkle
// marks), so each pose is normalized by its face bbox HEIGHT: bh = bbox
// height fraction of the frame, cy = bbox vertical center (the anchor that
// maps to FACE_CY). On-screen head height is constant across poses.
const MAN_POSE = {
  a: { idle: { bh: 0.616, cy: 0.444 }, wince: { bh: 0.595, cy: 0.459 },
       teary: { bh: 0.600, cy: 0.437 }, happy: { bh: 0.528, cy: 0.461 } },
  b: { idle: { bh: 0.589, cy: 0.445 }, wince: { bh: 0.613, cy: 0.411 },
       teary: { bh: 0.590, cy: 0.399 }, happy: { bh: 0.689, cy: 0.431 } },
};
// Beard-root arc (ellipse) semi-axes in FACE_R units, hugging each jaw line
// (a is a wide egg-shaped head, b a narrower square jaw).
const MAN_ARC = {
  a: { rx: 1.00, ry: 0.92 },
  b: { rx: 0.90, ry: 0.94 },
};
// beard-hair hangs DOWN with the root bulb on top: anchor at the bulb center,
// vis = visible strand share of the frame height.
const HAIR_SPR = { ay: 0.12, vis: 0.79 };
const BENT_SPR = { ax: 0.35, ay: 0.31 };   // kinked stub: anchor at its top end
const TWZ_SPR = { ax: 0.49, ay: 0.10 };    // tweezers-up: tips at the top
const ROD_SRC = { x: 0.05, y: 0.41, w: 0.90, h: 0.11 }; // bar crop inside rod.png

// angle (radians) for a grow offset o in [0, 3.5] — later hair = further right
function hairAngle(o) {
  return (ARC_L + (o / 3.5) * ARC_SPAN) * Math.PI / 180;
}
function cycleStartBeat(c) { return INTRO + c * CYCLE; }

// ---------- run state ----------
let mode = 'off';        // off | main | done
let musicBuffer = null;
let session = null;
let cycles = [];         // per-customer view state
let noteRefs = [];       // chart note objects (carry {c, h} back-refs)
let fxList = [];
let missTotal = 0;
let desatUntil = -1;     // songTime: brief background desaturation (§4.2)
let lastIdleTap = -1e9;
let snapUntil = -1;      // tweezers pinch-jab flash (songTime)
let recoilUntil = -1;    // tweezers downward recoil (ace)
let wobbleUntil = -1;    // tweezers stagger (barely)
let fadeStarted = false;
let finishedSummary = null;
let bonusFlash = -1;     // songTime of the bonus-star all-ace flash

function makeCycles(chart) {
  return chart.map(([face, pat], c) => {
    const start = cycleStartBeat(c);
    const hairs = PATTERNS[pat].map((off, h) => ({
      off,
      angle: hairAngle(off),
      growBeat: start + off,
      pluckBeat: start + off + ECHO,
      state: 'pending',   // pending | plucked | bent | missed
      // the showpiece: only the very last hair of the chart is drawn big
      big: c === chart.length - 1 && h === PATTERNS[pat].length - 1,
    }));
    return {
      face, start, hairs,
      resolved: 0, anyMiss: false, allClear: false, allAce: false,
      flash: null, flashUntil: -1,   // temporary face override ('wince')
    };
  });
}

function buildNotes() {
  noteRefs = [];
  cycles.forEach((cy, c) => {
    cy.hairs.forEach((hair, h) => {
      noteRefs.push({ beat: hair.pluckBeat, type: 'hair', c, h });
    });
  });
  return noteRefs;
}

// ---------- SFX cue scheduling ----------
// Boing on every growBeat (+10% pitch per hair in a fast cluster) and the
// "One! Two! Three!" count voice (countin-beep at do-re-mi playback rates,
// spec §5.1) on call-measure beats 2..4 of every cycle. Both are guide cues:
// they sit well under the BGM (feedback: they were far too loud).
const COUNT_RATES = [1.0, 1.122, 1.26];
const COUNT_GAIN = 0.42; // was effectively 1.0

function scheduleCycleCues(cy) {
  let run = 0, prevOff = -10;
  cy.hairs.forEach((hair) => {
    run = (hair.off - prevOff) <= 0.5 ? run + 1 : 0;
    prevOff = hair.off;
    const mul = 1 + 0.1 * run;
    conductor.scheduleAt(conductor.beatToCtx(hair.growBeat), (when) => {
      sfx.boing(when, mul); // the visual pop keys off `beat` in drawHair
    });
  });
  for (let i = 0; i < 3; i++) {
    sfx.scheduleOnBeat('count', cy.start + 1 + i, { rate: COUNT_RATES[i], gain: COUNT_GAIN });
  }
}

// ---------- public lifecycle ----------

export function start({ buffer }) {
  musicBuffer = buffer;
  fxList = [];
  missTotal = 0;
  desatUntil = -1;
  snapUntil = recoilUntil = wobbleUntil = -1;
  bonusFlash = -1;
  fadeStarted = false;
  finishedSummary = null;
  enterMain();
}

export function stop() {
  mode = 'off';
  session = null;
  conductor.stopSong();
}

function enterMain() {
  mode = 'main';
  cycles = makeCycles(CHART);
  conductor.startSong(musicBuffer, {
    bpm: BPM,
    chartOffset: CHART_OFFSET,
    countInBeats: 0, // the 8-beat rod-only intro is the count-in / warm-up
  });
  session = new JudgeSession(buildNotes(), conductor.beatToTime, 1);
  for (const cy of cycles) scheduleCycleCues(cy);
}

// ---------- input ----------

export function tap(songTime) {
  if (mode !== 'main') return;
  const res = session.tap(songTime);
  if (res.kind === 'hit') {
    applyResult(res, songTime);
  } else {
    // Whiff: tweezers pinch thin air with a soft click (0.15s anti-spam).
    if (songTime - lastIdleTap < 0.15) return;
    lastIdleTap = songTime;
    sfx.play('click', 0, { gain: 0.4 });
    snapUntil = songTime + 0.12;
  }
}

function applyResult(res, inputTime) {
  const note = res.note;
  const grade = res.judgment.grade;
  const cy = cycles[note.c];
  const hair = cy.hairs[note.h];
  const hadInput = res.judgment.delta !== null;
  const st = inputTime !== undefined ? inputTime : conductor.songTime();
  cy.resolved++;

  if (grade === 'ace') {
    hair.state = 'plucked';
    sfx.play('hit');
    spawnFly(cy, hair, st);
    spawnPop(cy, hair, st, false);
    snapUntil = st + 0.12;
    recoilUntil = st + 0.10;
    cy.flash = 'wince';            // pluck-recoil: 1-frame eye-squeeze (§4.1)
    cy.flashUntil = st + 0.09;     // ...then straight back (restraint on success)
  } else if (grade === 'barely') {
    hair.state = 'bent';           // half-plucked, a kinked stub remains (§3.2)
    sfx.play('barely');
    spawnDrop(cy, st, 'sweat');
    snapUntil = st + 0.12;
    wobbleUntil = st + 0.25;
    cy.flash = 'wince';
    cy.flashUntil = st + (60 / BPM) * 0.5; // 0.5 beats (§4.1)
  } else {
    hair.state = 'missed';         // hair survives until the man exits (§3.2)
    cy.anyMiss = true;
    missTotal++;
    sfx.play('miss', 0, { gain: hadInput ? 1 : 0.7 });
    spawnDrop(cy, st, 'tear');
    if (missTotal >= 3) desatUntil = st + 0.8; // crowd-silence translation (§4.2)
    if (hadInput) snapUntil = st + 0.12;
  }

  if (cy.resolved >= cy.hairs.length && !cy.anyMiss) {
    cy.allClear = true; // happy face until exit (§4.1)
    cy.allAce = cy.hairs.every((hh) => hh.state === 'plucked');
    if (note.c === BONUS_CYCLE && cy.allAce) {
      bonusFlash = st; // Skill-Star homage sparkle (§1.4)
      sfx.play('hit', 0, { rate: 1.5, gain: 0.8 });
    }
  }
}

// ---------- fx ----------

function spawnFly(cy, hair, st) {
  const p = hairRootPos(cy, hair, conductor.timeToBeat(st));
  const dirX = Math.cos(hair.angle), dirY = -Math.sin(hair.angle); // > 0 = down
  fxList.push({
    kind: 'fly', t0: st, life: 0.9,
    x: p.x + dirX * HAIR_LEN * 0.6, y: p.y + dirY * HAIR_LEN * 0.6,
    // small outward pop, then gravity takes it: a tumbling parabola downward
    vx: dirX * 230 + 50, vy: dirY * 120 - 60,
    rot0: Math.random() * 6.28, spin: 9 + Math.random() * 5,
    big: hair.big,
  });
}

function spawnPop(cy, hair, st, gold) {
  const p = hairRootPos(cy, hair, conductor.timeToBeat(st));
  fxList.push({ kind: 'pop', t0: st, life: 0.28, x: p.x, y: p.y, gold });
}

function spawnDrop(cy, st, flavor) {
  const beat = conductor.timeToBeat(st);
  const x = vegOffsetX(cyIndex(cy), beat) + FACE_CX + (flavor === 'sweat' ? FACE_R * 0.45 : FACE_R * 0.25);
  fxList.push({
    kind: 'drop', t0: st, life: 0.7,
    x, y: FACE_CY - FACE_R * 0.25,
    vx: flavor === 'sweat' ? 70 : 25, vy: -60,
  });
}

function cyIndex(cy) { return cycles.indexOf(cy); }

// ---------- frame ----------

/** Advance + draw one frame. Returns 'running' | 'ended'. */
export function frame(ctx, dt) {
  const st = conductor.songTime();
  const beat = conductor.timeToBeat(st);

  if (mode === 'main') {
    for (const res of session.sweep(st)) applyResult(res);
    if (beat >= END_BEAT - 2 && !fadeStarted) {
      fadeStarted = true;
      conductor.fadeOutSong(2 * 60 / BPM); // ease the cut, music is longer
    }
    if (beat >= END_BEAT) {
      finishedSummary = session.summary();
      mode = 'done';
      conductor.stopSong();
    }
  }

  draw(ctx, st, beat);
  return mode === 'done' ? 'ended' : 'running';
}

export function summary() { return finishedSummary; }
export function getMode() { return mode; }

/** QA/debug hook: enough state to land timed taps from a test harness. */
export function debugState() {
  const st = conductor.songTime();
  let nextPluck = null;
  if (session) {
    for (const e of session.entries) {
      if (e.state === 'pending') { nextPluck = e.time; break; }
    }
  }
  return { mode, songTime: st, beat: conductor.timeToBeat(st), nextPluck };
}

// ---------- drawing ----------

const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
// overshooting pop-in for hair growth
function easeOutBack(t) {
  const c = 2.2;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

function drawSprite(ctx, im, x, y, h, opts) {
  if (!im) return;
  const iw = im.width || 64, ih = im.height || 64;
  const w = h * iw / ih;
  const ax = opts && opts.ax !== undefined ? opts.ax : 0.5;
  const ay = opts && opts.ay !== undefined ? opts.ay : 0.5;
  ctx.save();
  ctx.translate(x, y);
  if (opts && opts.rot) ctx.rotate(opts.rot);
  if (opts && opts.sx !== undefined) ctx.scale(opts.sx, opts.sy !== undefined ? opts.sy : opts.sx);
  if (opts && opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.drawImage(im, -w * ax, -h * ay, w, h);
  ctx.restore();
}

// face horizontal offset for cycle c at `beat` (slide in/out, spec §2)
function vegOffsetX(c, beat) {
  const inStart = cycleStartBeat(c) - 0.75;   // = prev cycle beat 8.25
  const inEnd = inStart + 1;
  const outStart = cycleStartBeat(c + 1) - 0.75;
  const outEnd = outStart + 1;
  if (beat < inStart) return SLIDE_X;
  if (beat < inEnd) return lerp(SLIDE_X, 0, easeOut((beat - inStart) / 1));
  if (beat < outStart) return 0;
  if (beat < outEnd) return lerp(0, -SLIDE_X, easeOut((beat - outStart) / 1));
  return -SLIDE_X;
}

function hairRootPos(cy, hair, beat) {
  const ox = vegOffsetX(cyIndex(cy), beat);
  const arc = MAN_ARC[cy.face];
  return {
    x: FACE_CX + ox + Math.cos(hair.angle) * FACE_R * arc.rx,
    y: FACE_CY - Math.sin(hair.angle) * FACE_R * arc.ry,
  };
}

function faceState(cy, st) {
  if (cy.flash && st < cy.flashUntil) return cy.flash;
  if (cy.allClear) return 'happy';
  if (cy.anyMiss) return 'teary';
  return 'idle';
}

// background pastel: lavender, drifting toward mint as the chart progresses
function bgColor(beat) {
  const t = mode === 'main' || mode === 'done'
    ? clamp01((beat - INTRO) / (CHART.length * CYCLE)) : 0;
  const r = Math.round(lerp(226, 206, t));
  const g = Math.round(lerp(216, 234, t));
  const b = Math.round(lerp(245, 226, t));
  return `rgb(${r},${g},${b})`;
}

let bgPatternCache = null;
function bgPattern(ctx) {
  if (!bgPatternCache) {
    const im = img('bg-pattern');
    if (im) bgPatternCache = ctx.createPattern(im, 'repeat');
  }
  return bgPatternCache;
}

function draw(ctx, st, beat) {
  ctx.save();

  // -- background --
  ctx.fillStyle = bgColor(beat);
  ctx.fillRect(0, 0, W, H);
  const pat = bgPattern(ctx);
  if (pat) {
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // -- rod (runs behind the heads; wobbles when a customer lands, spec §2) --
  let rodY = ROD_Y;
  const slidePhase = ((beat - (INTRO - 0.75)) % CYCLE + CYCLE) % CYCLE;
  if (slidePhase > 0.9 && slidePhase < 1.25 && beat > INTRO) {
    rodY += Math.sin((slidePhase - 0.9) * 40) * 3;
  }
  // crop the bar out of rod.png (big transparent padding) and stretch it
  const rodIm = img('rod');
  if (rodIm) {
    const iw = rodIm.width, ih = rodIm.height;
    ctx.drawImage(rodIm,
      ROD_SRC.x * iw, ROD_SRC.y * ih, ROD_SRC.w * iw, ROD_SRC.h * ih,
      -10, rodY - ROD_H / 2, W + 20, ROD_H);
  }

  // -- faces (current + neighbours while sliding) --
  for (let c = 0; c < cycles.length; c++) {
    const ox = vegOffsetX(c, beat);
    if (Math.abs(ox) >= SLIDE_X - 1) continue;
    drawFace(ctx, cycles[c], ox, st, beat);
  }

  // -- tweezers sweep --
  drawTweezers(ctx, st, beat);

  // -- fx --
  drawFx(ctx, st);

  // -- intro overlay (the warm-up beats) --
  if (mode === 'main' && beat < INTRO) drawIntroUI(ctx, beat);
  if (bonusFlash >= 0 && st - bonusFlash < 0.9) drawBonusStar(ctx, st - bonusFlash);

  // -- miss-streak desaturation moment (§4.2) --
  if (st < desatUntil) {
    ctx.fillStyle = 'rgba(120,120,120,0.07)';
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

function drawFace(ctx, cy, ox, st, beat) {
  const x = FACE_CX + ox;
  // beat bounce: quick squash right on the beat, ±2% (spec §2)
  const phase = ((beat % 1) + 1) % 1;
  const sq = Math.max(0, 1 - phase * 3.2);
  const sx = 1 + 0.02 * sq;
  const sy = 1 - 0.025 * sq;
  // grow-twitch: tiny hop when a hair pops (§4.1)
  let hop = 0;
  for (const hair of cy.hairs) {
    const dt = beat - hair.growBeat;
    if (dt >= 0 && dt < 0.18) hop = Math.max(hop, (1 - dt / 0.18) * 5);
  }

  const face = faceState(cy, st);
  const im = img(`man-${cy.face}-${face}`);
  const m = MAN_POSE[cy.face][face] || MAN_POSE[cy.face].idle;
  // normalize so the on-screen head height is 2*FACE_R for every pose
  drawSprite(ctx, im, x, FACE_CY - hop, FACE_R * 2 / m.bh, { sx, sy, ay: m.cy });

  // beard hairs ride the chin
  for (const hair of cy.hairs) {
    drawHair(ctx, cy, hair, ox, beat);
  }
}

function drawHair(ctx, cy, hair, ox, beat) {
  if (hair.state === 'plucked') return;
  if (beat < hair.growBeat) return; // pops exactly on the boing
  const t = clamp01((beat - hair.growBeat) / 0.4);
  let scale = easeOutBack(Math.max(t, 0.02));
  if (hair.big) scale *= 1.45; // the showpiece final hair (§1.4)
  const arc = MAN_ARC[cy.face];
  const rx = FACE_CX + ox + Math.cos(hair.angle) * FACE_R * arc.rx;
  const ry = FACE_CY - Math.sin(hair.angle) * FACE_R * arc.ry;
  // the sprite hangs straight down: rot 0 at the chin's lowest point (270°)
  const rot = 3 * Math.PI / 2 - hair.angle;
  if (hair.state === 'bent') {
    drawSprite(ctx, img('beard-bent'), rx, ry, HAIR_LEN * 1.1,
      { rot, ax: BENT_SPR.ax, ay: BENT_SPR.ay });
  } else {
    // sprite frame is taller than the strand: compensate so the visible
    // strand length is HAIR_LEN at full growth
    drawSprite(ctx, img('beard-hair'), rx, ry, (HAIR_LEN / HAIR_SPR.vis) * scale,
      { rot, ay: HAIR_SPR.ay });
  }
}

// Tweezers: deadpan constant-speed sweep from below, left → right along the
// chin arc. Visible from 0.5 beat before the response measure; angle is
// linear in beat so it crosses each hair exactly at growBeat + 4 (spec §2).
function drawTweezers(ctx, st, beat) {
  // which cycle's response window are we in?
  let active = null;
  for (let c = 0; c < cycles.length; c++) {
    const s = cycles[c].start;
    if (beat >= s + ECHO - 0.5 && beat <= s + ECHO + 3.9) { active = cycles[c]; break; }
  }
  if (!active) return;
  const prog = beat - active.start - ECHO;          // 0 at first possible pluck slot
  const angle = hairAngle(prog);                    // same mapping as the hairs
  const arc = MAN_ARC[active.face];
  // tips ride just below the hair tips, on the same (elliptical) arc
  let x = FACE_CX + Math.cos(angle) * (FACE_R * arc.rx + HAIR_LEN * 0.8);
  let y = FACE_CY - Math.sin(angle) * (FACE_R * arc.ry + HAIR_LEN * 0.8);
  let sx = 1;
  if (st < snapUntil) { y -= 6; sx = 0.93; }                     // pinch jab
  if (st < recoilUntil) y += 10;                                 // ace recoil (away = down)
  if (st < wobbleUntil) x += Math.sin(st * 60) * 3;              // barely stagger
  const im = img('tweezers-up');
  const rot = (angle - 3 * Math.PI / 2) * 0.35; // lean slightly along the arc
  drawSprite(ctx, im, x, y, FACE_R * 2.3, { rot, sx, sy: 1, ax: TWZ_SPR.ax, ay: TWZ_SPR.ay });
}

function drawFx(ctx, st) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    const t = st - f.t0;
    if (t > f.life || t < 0) { fxList.splice(i, 1); continue; }
    const k = t / f.life;
    if (f.kind === 'fly') {
      const x = f.x + f.vx * t;
      const y = f.y + f.vy * t + 800 * t * t; // root and all, tumbling down
      drawSprite(ctx, img('beard-fly'), x, y, HAIR_LEN * (f.big ? 1.5 : 1),
        { rot: f.rot0 + f.spin * t, alpha: 1 - k * k });
    } else if (f.kind === 'pop') {
      const s = 0.5 + 1.1 * easeOut(k);
      drawSprite(ctx, img('fx-pop'), f.x, f.y, FACE_R * 0.7 * s, { alpha: 1 - k });
    } else if (f.kind === 'drop') {
      const x = f.x + f.vx * t;
      const y = f.y + f.vy * t + 900 * t * t;
      drawSprite(ctx, img('fx-drop'), x, y, 26, { alpha: 1 - k * k });
    }
  }
}

function drawBonusStar(ctx, t) {
  const k = t / 0.9;
  drawSprite(ctx, img('fx-pop'), FACE_CX, FACE_CY - FACE_R - 60,
    120 * (0.6 + easeOut(k)), { alpha: 1 - k, rot: k * 1.2 });
}

function drawIntroUI(ctx, beat) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(42,35,51,0.75)';
  ctx.font = '900 26px -apple-system, sans-serif';
  const blink = Math.sin(beat * Math.PI) > -0.2 ? 1 : 0.4;
  ctx.globalAlpha = blink;
  ctx.fillText('First customer coming up...', W / 2, H * 0.20);
  ctx.restore();
}
