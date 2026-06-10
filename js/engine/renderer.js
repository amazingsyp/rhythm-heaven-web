// renderer.js — canvas setup, devicePixelRatio, letterboxing, rAF loop.
// Logical resolution is fixed at 480x720 (portrait). The #frame element is
// scaled with CSS to fit the window; the canvas backing store is scaled by
// DPR so lines stay crisp. The rAF loop is RENDER-ONLY: judgments happen at
// input-event time, so frame rate never affects judging accuracy.

export const W = 480;
export const H = 720;

export function createRenderer(canvas, frameEl) {
  const ctx = canvas.getContext('2d');
  let rafId = 0;
  let running = false;
  let frameCb = null;
  let lastTs = 0;

  function layout() {
    // Letterbox: fit a W:H box inside the window, centered by #app flexbox.
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const cssW = Math.floor(W * scale);
    const cssH = Math.floor(H * scale);
    frameEl.style.width = cssW + 'px';
    frameEl.style.height = cssH + 'px';

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function loop(ts) {
    if (!running) return;
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0.016;
    lastTs = ts;
    if (frameCb) frameCb(dt);
    rafId = requestAnimationFrame(loop);
  }

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  layout();

  return {
    ctx,
    W,
    H,
    layout,
    start(cb) {
      frameCb = cb;
      if (!running) {
        running = true;
        lastTs = 0;
        rafId = requestAnimationFrame(loop);
      }
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      frameCb = null;
    },
    clear(color = '#fff4e0') {
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    },
  };
}
