let _instance = null;

export function initFlowField() {
  if (_instance) {
    _instance.cleanup();
    _instance = null;
  }

  const hero = document.getElementById('hero');
  const canvas = document.getElementById('flow-canvas');
  if (!hero || !canvas) return () => {};

  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  /* ── State ────────────────────────────────── */
  let W = 0;
  let H = 0;
  let DPR = 1;
  let leftW = 0;
  let leftH = 0;
  let stackedLayout = false;

  let MX = -99999;
  let MY = -99999;
  let mActive = false;

  let grid = [];
  let t0 = null;
  let rafId = null;
  let resizeTimer = null;
  let ro = null;

  /* ── Noise constants ──────────────────────── */
  const S1 = 0.00175;
  const S2 = 0.0042;

  /* ── Grid / dash constants ────────────────── */
  const DASH_L = 11.5;
  const DASH_W = 1.35;

  /* ── Wave constants ───────────────────────── */
  const WAVE_PASS_MS = 22000;
  const SETTLE_MS = 34000;
  const CYCLE_MS = 42000;
  const WAVE_STROKE = 1.2;
  const WAVE_OP_MIN = 0.18;
  const WAVE_OP_MAX = 0.28;
  const DOT_RADIUS = 5;
  const DOT_HOLD_MS = 400;
  const MORPH_DUR_MS = 420;
  const LABEL_DELAY_MS = 280;
  const LABEL_DUR_MS = 300;
  const WAVE_FALLOFF = 22;
  const ALIGN_STRENGTH = 0.38;

  /* ── Wave state ───────────────────────────── */
  let waveStartMs = -CYCLE_MS;
  let waveCx = 0;
  let waveCy = 0;
  let waveRmax = 0;
  let waveRmin = 6;
  let dotAlpha = 0;
  let symbolAlpha = 0;
  let labelAlpha = 0;

  /* ── Pointer/touch handlers ───────────────── */
  function onMouseMove(e) {
    const r = canvas.getBoundingClientRect();
    MX = e.clientX - r.left;
    MY = e.clientY - r.top;
    mActive = true;
  }

  function onMouseLeave() {
    mActive = false;
  }

  function onTouchMove(e) {
    if (e.touches.length > 0) {
      const r = canvas.getBoundingClientRect();
      MX = e.touches[0].clientX - r.left;
      MY = e.touches[0].clientY - r.top;
      mActive = true;
    }
  }

  function onTouchEnd() {
    mActive = false;
  }

  hero.addEventListener('mousemove', onMouseMove);
  hero.addEventListener('mouseleave', onMouseLeave);
  hero.addEventListener('touchmove', onTouchMove, { passive: true });
  hero.addEventListener('touchend', onTouchEnd);
  hero.addEventListener('touchcancel', onTouchEnd);

  /* ── Value noise ──────────────────────────── */
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function h2(ix, iy) {
    let n = (ix * 1619 + iy * 31337) | 0;
    n = ((n << 13) ^ n) | 0;
    n = (Math.imul(n, Math.imul(n, n) * 15731 + 789221) + 1376312589) | 0;
    return ((n >>> 0) & 0x7fffffff) / 2147483647.0;
  }

  function n2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);

    return (
      h2(ix, iy) * (1 - u) * (1 - v) +
      h2(ix + 1, iy) * u * (1 - v) +
      h2(ix, iy + 1) * (1 - u) * v +
      h2(ix + 1, iy + 1) * u * v
    );
  }

  function n3D(x, y, z) {
    const iz = Math.floor(z);
    const fz = z - iz;

    return (
      n2D(x + iz * 127.1, y + iz * 311.7) * (1 - fade(fz)) +
      n2D(x + (iz + 1) * 127.1, y + (iz + 1) * 311.7) * fade(fz)
    );
  }

  function fieldAngle(wx, wy, t) {
    const nx1 = n3D(wx * S1, wy * S1, t) - 0.5;
    const ny1 = n3D(wx * S1 + 17.3, wy * S1 + 4.8, t) - 0.5;
    const nx2 = (n3D(wx * S2, wy * S2, t * 1.9) - 0.5) * 0.35;
    const ny2 = (n3D(wx * S2 + 31.7, wy * S2 + 9.4, t * 1.9) - 0.5) * 0.35;
    return Math.atan2(ny1 + ny2, nx1 + nx2);
  }

  function smoothstep(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  }

  /* ── Layout / sizing ──────────────────────── */
  function updateLayoutMode() {
    stackedLayout = window.getComputedStyle(hero).flexDirection === 'column';
  }

  function getSpacing() {
    const area = W * H;
    if (area < 300000) return 44;
    if (area < 600000) return 40;
    return 36;
  }

  function buildGrid() {
    grid = [];
    const spacing = getSpacing();
    const cols = Math.ceil(W / spacing) + 2;
    const rows = Math.ceil(H / spacing) + 2;
    const jitter = spacing * 0.08;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid.push({
          x: c * spacing - spacing * 0.5 + (Math.random() - 0.5) * jitter,
          y: r * spacing - spacing * 0.5 + (Math.random() - 0.5) * jitter,
        });
      }
    }
  }

  function measure() {
    const rect = hero.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;

    const colLeft = document.getElementById('col-left');
    if (colLeft) {
      const leftRect = colLeft.getBoundingClientRect();
      leftW = leftRect.width;
      leftH = leftRect.height;
    } else {
      leftW = W * 0.45;
      leftH = H * 0.45;
    }

    updateLayoutMode();
  }

  function resize() {
    measure();
    if (!W || !H) return false;

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    buildGrid();
    return true;
  }

  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (resize()) {
        computeWaveGeometry();
      }
    }, 80);
  }

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(scheduleResize);
    ro.observe(hero);
  }

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  /* ── Opacity map ──────────────────────────── */
  function dashOpacity(gx) {
    if (stackedLayout) {
      const fadeStart = W * 0.04;
      const fadeEnd = W * 0.22;
      const opMin = 0.06;
      const opMax = 0.42;

      if (gx < fadeStart) return opMin;
      if (gx > fadeEnd) return opMax;

      const t = (gx - fadeStart) / (fadeEnd - fadeStart);
      return opMin + smoothstep(t) * (opMax - opMin);
    }

    const textEdge = leftW * 0.5;
    const fadeStart = leftW * 0.5;
    const fadeEnd = leftW * 1.05;
    const opMin = 0.04;
    const opMax = 0.495;

    if (gx < textEdge) return opMin;
    if (gx > fadeEnd) return opMax;

    const t = (gx - fadeStart) / (fadeEnd - fadeStart);
    return opMin + smoothstep(t) * (opMax - opMin);
  }

  /* ── Wave geometry ────────────────────────── */
  function computeWaveGeometry() {
    if (stackedLayout) {
      const visualZoneTop = leftH;
      const visualZoneHeight = Math.max(H - visualZoneTop, H * 0.22);

      waveCx = W * 0.52;
      waveCy = visualZoneTop + visualZoneHeight * 0.62;
    } else {
      waveCx = leftW + (W - leftW) * 0.72;
      waveCy = H * 0.5;
    }

    waveRmax =
      Math.sqrt(
        Math.pow(waveCx + W * 0.12, 2) +
          Math.pow(Math.max(waveCy, H - waveCy) + H * 0.1, 2)
      ) + 60;

    waveRmin = 6;
  }

  function alignFalloff(signedDist) {
    if (signedDist < -WAVE_FALLOFF) return 1;
    if (signedDist > 0) return 0;
    return smoothstep(-signedDist / WAVE_FALLOFF);
  }

  function dashWaveInfluence(gx, gy, currentRadius, settling) {
    if (currentRadius < 0) return { align: 0 };

    const dx = gx - waveCx;
    const dy = gy - waveCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const sd = dist - currentRadius;

    let align = alignFalloff(sd) * ALIGN_STRENGTH;
    if (settling > 0) align *= 1 - settling;

    return { align };
  }

  /* ── Render loop ──────────────────────────── */
  function render(ts) {
    rafId = requestAnimationFrame(render);

    if (!W || !H) return;

    if (!t0) t0 = ts;
    const ms = ts - t0;
    const t = ms * 3.8e-5;
    const wallMs = ms;

    let timeSinceWave = wallMs - waveStartMs;
    let currentRadius = -1;
    let settlingFrac = 0;
    let waveVisible = false;
    let waveOpacity = 0;

    if (timeSinceWave >= CYCLE_MS) {
      waveStartMs = wallMs;
      timeSinceWave = 0;
      computeWaveGeometry();
      dotAlpha = 0;
      symbolAlpha = 0;
      labelAlpha = 0;
    }

    if (timeSinceWave < WAVE_PASS_MS) {
      const passProgress = timeSinceWave / WAVE_PASS_MS;
      const p = 1 - passProgress;

      currentRadius = waveRmin + p * p * p * (waveRmax - waveRmin);
      waveVisible = true;

      const opFade =
        Math.min(passProgress * 6, 1) * Math.min((1 - passProgress) * 6, 1);
      waveOpacity = WAVE_OP_MIN + opFade * (WAVE_OP_MAX - WAVE_OP_MIN);

      const dotAppear = Math.max(0, (passProgress - 0.85) / 0.15);
      dotAlpha = dotAppear * dotAppear;
      symbolAlpha = 0;
      labelAlpha = 0;
    } else if (timeSinceWave < SETTLE_MS) {
      const rawFrac = (timeSinceWave - WAVE_PASS_MS) / (SETTLE_MS - WAVE_PASS_MS);
      const fadeEnd = 0.35;
      const expandStart = 0.35;

      const settleMs = timeSinceWave - WAVE_PASS_MS;
      const morphStart = DOT_HOLD_MS;
      const morphEnd = DOT_HOLD_MS + MORPH_DUR_MS;
      const labelStart = morphEnd + LABEL_DELAY_MS;
      const labelEnd = labelStart + LABEL_DUR_MS;
      const holdTotalMs = (SETTLE_MS - WAVE_PASS_MS) * fadeEnd;

      if (settleMs < morphStart) {
        dotAlpha = 1;
      } else if (settleMs < morphEnd) {
        dotAlpha = 1 - smoothstep((settleMs - morphStart) / MORPH_DUR_MS);
      } else {
        dotAlpha = 0;
      }

      if (settleMs < morphStart) {
        symbolAlpha = 0;
      } else if (settleMs < morphEnd) {
        symbolAlpha = smoothstep((settleMs - morphStart) / MORPH_DUR_MS);
      } else if (settleMs < holdTotalMs * 0.85) {
        symbolAlpha = 1;
      } else {
        symbolAlpha = Math.max(
          0,
          1 - (settleMs - holdTotalMs * 0.85) / (holdTotalMs * 0.15)
        );
      }

      if (settleMs < labelStart) {
        labelAlpha = 0;
      } else if (settleMs < labelEnd) {
        labelAlpha = smoothstep((settleMs - labelStart) / LABEL_DUR_MS);
      } else if (settleMs < holdTotalMs * 0.85) {
        labelAlpha = 1;
      } else {
        labelAlpha = Math.max(
          0,
          1 - (settleMs - holdTotalMs * 0.85) / (holdTotalMs * 0.15)
        );
      }

      if (rawFrac < expandStart) {
        currentRadius = waveRmin;
        settlingFrac = 0;
      } else {
        const expandFrac = (rawFrac - expandStart) / (1 - expandStart);
        const expandP = expandFrac * expandFrac;
        currentRadius = waveRmin + expandP * (waveRmax - waveRmin);
        settlingFrac = 0;
      }

      waveVisible = false;
    } else {
      currentRadius = -1;
      waveVisible = false;
      dotAlpha = 0;
      symbolAlpha = 0;
      labelAlpha = 0;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineWidth = DASH_W;

    const hlen = DASH_L * 0.5;
    const mouseRadius = 150;
    const spacing = getSpacing();

    for (let i = 0, n = grid.length; i < n; i++) {
      const gx = grid[i].x;
      const gy = grid[i].y;

      if (gx < -spacing || gx > W + spacing) continue;
      if (gy < -spacing || gy > H + spacing) continue;

      let angle = fieldAngle(gx, gy, t);

      if (mActive) {
        const mdx = gx - MX;
        const mdy = gy - MY;
        const md2 = mdx * mdx + mdy * mdy;

        if (md2 < mouseRadius * mouseRadius) {
          const mfo = (1 - Math.sqrt(md2) / mouseRadius) ** 2;
          angle += Math.atan2(mdy, mdx) * mfo * 0.55;
        }
      }

      const inf = dashWaveInfluence(gx, gy, currentRadius, settlingFrac);
      if (inf.align > 0.001) {
        const calmAngle = fieldAngle(gx * 0.3, gy * 0.3, t * 0.4);
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const cb = Math.cos(calmAngle);
        const sb = Math.sin(calmAngle);

        angle = Math.atan2(
          sa * (1 - inf.align) + sb * inf.align,
          ca * (1 - inf.align) + cb * inf.align
        );
      }

      const baseOp = dashOpacity(gx);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const x0 = gx - cosA * hlen;
      const y0 = gy - sinA * hlen;
      const x1 = gx + cosA * hlen;
      const y1 = gy + sinA * hlen;

      let drawX0 = x0;
      let drawY0 = y0;
      let drawX1 = x1;
      let drawY1 = y1;
      let shouldDraw = true;

      if (currentRadius > 0) {
        const cx = waveCx;
        const cy = waveCy;
        const R = currentRadius;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const fx = x0 - cx;
        const fy = y0 - cy;
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - R * R;
        const disc = b * b - 4 * a * c;
        const R2 = R * R;
        const p0in = fx * fx + fy * fy <= R2;
        const ex = x1 - cx;
        const ey = y1 - cy;
        const p1in = ex * ex + ey * ey <= R2;

        if (!p0in && !p1in) {
          shouldDraw = false;
        } else if (!(p0in && p1in)) {
          if (disc < 0) {
            shouldDraw = false;
          } else {
            const sq = Math.sqrt(disc);
            const t1 = (-b - sq) / (2 * a);
            const t2 = (-b + sq) / (2 * a);
            const tClip = Math.max(
              0,
              Math.min(1, p0in ? Math.max(t1, t2) : Math.min(t1, t2))
            );

            if (p0in) {
              drawX1 = x0 + tClip * dx;
              drawY1 = y0 + tClip * dy;
            } else {
              drawX0 = x0 + tClip * dx;
              drawY0 = y0 + tClip * dy;
            }
          }
        }
      }

      if (!shouldDraw) continue;

      ctx.globalAlpha = baseOp;
      ctx.strokeStyle = '#1A3A6E';
      ctx.beginPath();
      ctx.moveTo(drawX0, drawY0);
      ctx.lineTo(drawX1, drawY1);
      ctx.stroke();
    }

    if (waveVisible && waveOpacity > 0 && currentRadius > 0) {
      ctx.globalAlpha = waveOpacity;
      ctx.strokeStyle = '#1A3A6E';
      ctx.lineWidth = WAVE_STROKE;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, currentRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineCap = 'round';
    }

    if (dotAlpha > 0) {
      ctx.globalAlpha = dotAlpha * 0.55;
      ctx.strokeStyle = '#1A3A6E';
      ctx.lineWidth = 1.0;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineCap = 'round';
      ctx.globalAlpha = dotAlpha;
      ctx.fillStyle = '#1A3A6E';
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    if (symbolAlpha > 0) {
      const s = 0.72;
      const ox = waveCx - 15 * s;
      const oy = waveCy - 15 * s;

      ctx.globalAlpha = symbolAlpha;
      ctx.strokeStyle = '#1A3A6E';
      ctx.lineWidth = 3.0;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 10;
      ctx.beginPath();
      ctx.moveTo(ox + 7 * s, oy + 5 * s);
      ctx.lineTo(ox + 23 * s, oy + 15 * s);
      ctx.lineTo(ox + 7 * s, oy + 25 * s);
      ctx.stroke();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    if (labelAlpha > 0) {
      const s = 0.72;
      const label = 'DECISION, MADE.';
      const isNarrow = W <= 420;

      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle = '#C6A86A';
      ctx.font = isNarrow
        ? '500 10px "IBM Plex Mono", monospace'
        : '500 11px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      const step = isNarrow ? 1.2 : 1.9;
      let labelWidth = 0;
      for (let i = 0; i < label.length; i++) {
        labelWidth += ctx.measureText(label[i]).width + step;
      }

      let labelX;
      let labelY;

      if (stackedLayout && isNarrow) {
        labelX = Math.max(16, Math.min(waveCx - labelWidth * 0.5, W - labelWidth - 16));
        labelY = waveCy + 26;
      } else {
        const rawLabelX = waveCx + (23 - 15) * s + 10;
        labelX = Math.max(16, Math.min(rawLabelX, W - labelWidth - 16));
        labelY = waveCy;
      }

      let lx = labelX;

      ctx.save();
      for (let li = 0; li < label.length; li++) {
        ctx.fillText(label[li], lx, labelY);
        lx += ctx.measureText(label[li]).width + step;
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  /* ── Boot ─────────────────────────────────── */
  if (resize()) {
    computeWaveGeometry();
  }

  rafId = requestAnimationFrame(render);

  /* ── Cleanup ──────────────────────────────── */
  function cleanup() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }

    if (ro) {
      ro.disconnect();
      ro = null;
    }

    hero.removeEventListener('mousemove', onMouseMove);
    hero.removeEventListener('mouseleave', onMouseLeave);
    hero.removeEventListener('touchmove', onTouchMove);
    hero.removeEventListener('touchend', onTouchEnd);
    hero.removeEventListener('touchcancel', onTouchEnd);

    window.removeEventListener('resize', scheduleResize);
    window.removeEventListener('orientationchange', scheduleResize);

    _instance = null;
  }

  _instance = { cleanup };
  return cleanup;
}