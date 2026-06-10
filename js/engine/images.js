// images.js — PNG sprite preloading. All character/prop art is generated
// PNG (assets/img/) — never draw characters with canvas paths (that was the
// reason the previous build was scrapped).
//
// If a file is missing the loader substitutes a loud magenta placeholder and
// records the name in `missing` so QA can assert missing.length === 0.

const LIST = [
  'man-a-idle', 'man-a-wince', 'man-a-teary', 'man-a-happy',
  'man-b-idle', 'man-b-wince', 'man-b-teary', 'man-b-happy',
  'beard-hair', 'beard-bent', 'beard-fly',
  'tweezers-up',
  'rod', 'fx-pop', 'fx-drop', 'bg-pattern',
  'result-x', 'result-ok', 'result-star',
];

const images = new Map();
export const missing = [];

function placeholder(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f0f';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#000';
  x.font = '10px monospace';
  x.fillText(name.slice(0, 10), 2, 32);
  return c;
}

/** Preload every sprite. onProgress(done, total) drives the loading screen. */
export async function loadAll(onProgress) {
  let done = 0;
  await Promise.all(LIST.map((name) => new Promise((resolve) => {
    const im = new Image();
    const finish = (ok) => {
      if (!ok) {
        missing.push(name);
        console.warn(`[images] missing sprite: assets/img/${name}.png — placeholder in use`);
        images.set(name, placeholder(name));
      } else {
        images.set(name, im);
      }
      done++;
      if (onProgress) onProgress(done, LIST.length);
      resolve();
    };
    im.onload = () => finish(true);
    im.onerror = () => finish(false);
    im.src = `assets/img/${name}.png`;
  })));
  return missing.length === 0;
}

export function get(name) { return images.get(name); }
export function url(name) { return `assets/img/${name}.png`; }
export const NAMES = LIST.slice();
