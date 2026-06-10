// judge.js — judgment windows, note matching, score aggregation.
// Windows (research doc): Ace ±40ms, Barely ±110ms, Miss beyond.
// A stage may scale both windows with its optional `judgeScale` field
// (e.g. 0.825 → Ace ±33ms hard, 1.25 → Ace ±50ms easy).

export const BASE_WINDOWS = { ace: 0.040, barely: 0.110 }; // seconds, one-sided

export function gradeDelta(delta, scale = 1) {
  const a = Math.abs(delta);
  if (a <= BASE_WINDOWS.ace * scale) return 'ace';
  if (a <= BASE_WINDOWS.barely * scale) return 'barely';
  return 'miss';
}

const ORDER = { miss: 0, barely: 1, ace: 2 };
function worse(a, b) { return ORDER[a] <= ORDER[b] ? a : b; }

function makeJudgment(grade, delta) {
  return {
    grade,                                  // 'ace' | 'barely' | 'miss'
    delta,                                  // seconds (input - target); null for auto-miss
    early: delta !== null && delta < 0,
    late: delta !== null && delta > 0,
  };
}

/**
 * One judging session per stage run.
 *   notes      — the stage's chart (beat-ascending). Entries may carry
 *                `hold: <beats>` for press+release notes (optional extension).
 *   beatToTime — beat → songTime converter (conductor's, bound to the song)
 *   scale      — judgeScale from the stage module
 */
export class JudgeSession {
  constructor(notes, beatToTime, scale = 1) {
    this.scale = scale;
    this.barelyWin = BASE_WINDOWS.barely * scale;
    this.entries = notes.map((note) => ({
      note,
      time: beatToTime(note.beat),
      holdTime: note.hold ? beatToTime(note.beat + note.hold) : null,
      state: 'pending', // pending → (holding) → done
      pressGrade: null,
    }));
    this.entries.sort((x, y) => x.time - y.time);
    this.results = []; // { note, judgment }
  }

  _record(entry, grade, delta) {
    entry.state = 'done';
    const judgment = makeJudgment(grade, delta);
    this.results.push({ note: entry.note, judgment });
    return { kind: 'hit', note: entry.note, judgment };
  }

  /**
   * Player pressed at songTime t.
   * Returns { kind: 'hit', note, judgment }
   *       | { kind: 'holdStart', note, judgment }   (press half of a hold note)
   *       | { kind: 'idle' }                        (no note in range — comic whiff)
   * Inputs earlier than (target - barely window) do NOT consume the note.
   */
  tap(t) {
    let candidate = null;
    for (const e of this.entries) {
      if (e.state !== 'pending') continue;
      if (e.time - t > this.barelyWin) break; // too early for this & later notes
      candidate = e;
      break;
    }
    if (!candidate) return { kind: 'idle' };

    const delta = t - candidate.time;
    const grade = gradeDelta(delta, this.scale); // 'ace' or 'barely' here

    if (candidate.holdTime !== null) {
      candidate.state = 'holding';
      candidate.pressGrade = grade;
      return { kind: 'holdStart', note: candidate.note, judgment: makeJudgment(grade, delta) };
    }
    return this._record(candidate, grade, delta);
  }

  /**
   * Player released at songTime t. Only meaningful while a hold note is active.
   * Final grade = worse(press, release); releasing earlier than the barely
   * window before the hold target is a miss.
   * Returns { kind: 'hit', ... } or null.
   */
  release(t) {
    const e = this.entries.find((x) => x.state === 'holding');
    if (!e) return null;
    const delta = t - e.holdTime;
    const relGrade = delta < -this.barelyWin ? 'miss' : gradeDelta(delta, this.scale);
    return this._record(e, worse(e.pressGrade, relGrade), delta);
  }

  /**
   * Call every frame: auto-resolve expired notes.
   * - pending note past target + barely window → miss
   * - hold still held past holdTarget + barely window → resolved as if
   *   released at the window edge ('barely' release)
   * Returns an array of { kind:'hit', note, judgment } to dispatch.
   */
  sweep(t) {
    const out = [];
    for (const e of this.entries) {
      if (e.state === 'pending' && t - e.time > this.barelyWin) {
        out.push(this._record(e, 'miss', null));
      } else if (e.state === 'holding' && t - e.holdTime > this.barelyWin) {
        out.push(this._record(e, worse(e.pressGrade, 'barely'), this.barelyWin));
      }
    }
    return out;
  }

  get done() { return this.results.length >= this.entries.length; }

  /** Aggregate: ace 1.0, barely 0.5, miss 0 → mean. */
  summary() {
    const counts = { ace: 0, barely: 0, miss: 0 };
    for (const r of this.results) counts[r.judgment.grade]++;
    const total = this.entries.length || 1;
    const score = (counts.ace + 0.5 * counts.barely) / total;
    let rank;
    if (counts.ace === total) rank = 'perfect';
    else if (score >= 0.8) rank = 'superb';
    else if (score >= 0.5) rank = 'ok';
    else rank = 'tryagain';
    return { counts, total, score, rank };
  }
}

export const RANK_LABEL = {
  perfect: 'Perfect!!',
  superb: 'Superb!',
  ok: 'OK',
  tryagain: 'Try Again',
};

// Rank ordering for "best rank" bookkeeping.
export const RANK_VALUE = { tryagain: 1, ok: 2, superb: 3, perfect: 4 };
