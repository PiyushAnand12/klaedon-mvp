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
  let leftTop = 0;
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
  const DASH_L = 7.0;
  const DASH_W = 3.5;

  /* ── Wave / sweep constants ───────────────── */
  const WAVE_PASS_MS    = 16000;  // faster sweep — feels more decisive
  const SETTLE_MS       = 30000;  // snappier convergence
  const CYCLE_MS        = 42000;
  const ALIGN_STRENGTH  = 0.34;   // stronger alignment snap during sweep
  const WAVE_STROKE     = 1.6;    // slightly bolder ring
  const WAVE_OP_MIN     = 0.22;
  const WAVE_OP_MAX     = 0.42;   // ring pops more at peak
  const DOT_RADIUS      = 5;
  const DOT_HOLD_MS     = 480;
  const MORPH_DUR_MS    = 380;    // crisper dot→arrow morph
  const LABEL_DELAY_MS  = 220;
  const LABEL_DUR_MS    = 340;
  const WAVE_FALLOFF    = 28;     // wider calm zone inside closing ring

  /* ── Wave state ───────────────────────────── */
  let waveStartMs = -CYCLE_MS;
  let waveCx      = 0;
  let waveCy      = 0;
  let waveRmax    = 0;
  let waveRmin    = 6;
  let dotAlpha    = 0;
  let symbolAlpha = 0;
  let labelAlpha  = 0;

  /* ── Pulse state (ring heartbeat after decision) ── */
  let pulseAlpha  = 0;
  let pulseRadius = 0;

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
    const jitter = spacing * 0.06;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid.push({
          x: c * spacing - spacing * 0.5 + (Math.random() - 0.5) * jitter,
          y: r * spacing - spacing * 0.5 + (Math.random() - 0.5) * jitter,
          seed: Math.random(), // for color variation
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
      const heroRect = hero.getBoundingClientRect();
      leftW   = leftRect.width;
      leftH   = leftRect.height;
      leftTop = leftRect.top - heroRect.top;
    } else {
      leftW   = W * 0.45;
      leftH   = H * 0.45;
      leftTop = H * 0.1;
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
      if (resize()) computeWaveGeometry();
    }, 80);
  }

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(scheduleResize);
    ro.observe(hero);
  }

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  /* ── Opacity map ──────────────────────────── */
  function dashOpacity(gx, seed, gy) {
    // Slight fade behind text block, full coverage elsewhere
    const textFadeEnd = leftW * 0.72;
    const opBase = 0.38 + seed * 0.14; // 0.38–0.52, varied per dash

    /* ── <=800 px: dashes fill entire hero; dim only dashes behind text ── */
    if (W <= 800) {
      // col-left bounds give us the exact text block position
      const txtY1 = leftTop + leftH * 0.18; // where headline starts
      const txtY2 = leftTop + leftH;         // where CTA ends

      if (gy >= txtY1 && gy <= txtY2) {
        const yFrac = (gy - txtY1) / (txtY2 - txtY1);
        // 12% at the headline top, ramping to ~55% by the CTA
        return opBase * (0.12 + yFrac * 0.43);
      }

      // Above headline and below CTA: full opacity
      return opBase;
    }

    /* ── >800 px: original behaviour ── */
    if (stackedLayout) {
      const textStart = leftTop + leftH * 0.18;
      const textEnd   = leftTop + leftH;

      if (gy >= textStart && gy <= textEnd) {
        const progress = (gy - textStart) / (textEnd - textStart);

        // At narrow viewports text fills almost full width — mask wider
        const narrow = W < 480;
        let maskWidth;
        if (progress < 0.45)      maskWidth = W * 0.90; // headline ends ~85% width
        else if (progress < 0.78) maskWidth = W * (narrow ? 1.0 : 0.72); // body copy
        else                      maskWidth = W * 0.54; // CTA button only

        if (gx < maskWidth) return 0;
      }

      return opBase;
    }

    if (gx < leftW * 0.38) return 0.06 + seed * 0.06;
    if (gx < textFadeEnd) {
      const t = (gx - leftW * 0.38) / (textFadeEnd - leftW * 0.38);
      return (0.06 + seed * 0.06) + smoothstep(t) * (opBase - 0.12);
    }
    return opBase;
  }

  /* ── Color picker — teal/cyan/navy + gold near decision ── */
  function dashColor(gx, gy, seed, t, waveTeal, goldProx) {
    // goldProx (0–1): dashes near the converging decision point warm to gold
    if (goldProx > 0.01) {
      const gt = goldProx;
      const r  = Math.round(198 * gt + 0   * (1 - gt));
      const g  = Math.round(168 * gt + 190 * (1 - gt));
      const b  = Math.round(106 * gt + 210 * (1 - gt));
      return `rgb(${r},${g},${b})`;
    }

    // noise-driven color blend across 3 brand colors
    // waveTeal (0–1) pulls the color toward teal as the wave sweeps through
    const colorNoise = n3D(gx * 0.006 + 3.1, gy * 0.006 + 7.4, t * 0.4);
    const boosted = colorNoise * (1 - waveTeal * 0.82); // drag toward 0 = teal range

    if (boosted < 0.3) {
      // vivid teal / cyan
      const r = Math.round(0   + boosted * 20);
      const g = Math.round(190 + boosted * 30);
      const b = Math.round(210 + boosted * 20);
      return `rgb(${r},${g},${b})`;
    } else if (boosted < 0.65) {
      // bright mid-blue
      const r = Math.round(20  + (boosted - 0.3) * 40);
      const g = Math.round(100 + (boosted - 0.3) * 40);
      const b = Math.round(200 + (boosted - 0.3) * 20);
      return `rgb(${r},${g},${b})`;
    } else {
      // saturated navy
      return '#0F2A6B';
    }
  }

  /* ── Diagonal sweep wave (noise-warped front) ─ */
  // The wave front advances along the diagonal (gx + gy), but its edge is
  // warped by low-frequency noise so it looks organic / curvy, not a ruler line.
  function dashWaveInfluence(gx, gy, timeSinceWave) {
    if (timeSinceWave <= 0 || timeSinceWave >= WAVE_PASS_MS) {
      return { align: 0, teal: 0 };
    }

    const progress  = timeSinceWave / WAVE_PASS_MS;
    const maxDiag   = W + H;
    const waveWidth = Math.min(W, H) * 0.65 + 180; // broad soft band

    // Warp the front edge with noise so it's organic, not a straight line
    // Use a slow-moving noise so the warp shape evolves gently over time
    const warpAmp   = waveWidth * 0.45;
    const warpNoise = (n2D(gx * 0.004 + 5.1, gy * 0.004 + 2.7) - 0.5) * 2; // -1..1
    const warp      = warpNoise * warpAmp;

    // Wave front position along the diagonal axis (with per-point warp)
    const wavePos = progress * (maxDiag + waveWidth) - waveWidth * 0.5 + warp;
    const diag    = gx + gy;
    const dist    = diag - wavePos; // negative = already swept, positive = ahead

    const half    = waveWidth * 0.5;
    if (dist < -half || dist > half) return { align: 0, teal: 0 };

    // Smooth bell — peaks at the wave front, fades to edges
    const strength = smoothstep(1 - Math.abs(dist) / half);

    return {
      align: strength * ALIGN_STRENGTH,
      teal:  strength,
    };
  }
  /* ── Circle wave geometry ─────────────────── */
  function computeWaveGeometry() {
    if (stackedLayout) {
      const visualZoneTop    = leftH;
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

  function circleWaveAlign(gx, gy, currentRadius) {
    if (currentRadius < 0) return 0;
    const dx   = gx - waveCx;
    const dy   = gy - waveCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return alignFalloff(dist - currentRadius) * 0.38;
  }

  /* ── Render loop ──────────────────────────── */
  function render(ts) {
    rafId = requestAnimationFrame(render);
    if (!W || !H) return;

    if (!t0) t0 = ts;
    const ms = ts - t0;
    const t  = ms * 3.8e-5;

    let timeSinceWave = ms - waveStartMs;

    /* ── Cycle reset ── */
    if (timeSinceWave >= CYCLE_MS) {
      waveStartMs   = ms;
      timeSinceWave = 0;
      computeWaveGeometry();
      dotAlpha = symbolAlpha = labelAlpha = 0;
      pulseAlpha = pulseRadius = 0;
    }

    /* ── Circle closing-in state ── */
    let currentRadius = -1;
    let waveVisible   = false;
    let waveOpacity   = 0;

    if (timeSinceWave < WAVE_PASS_MS) {
      const passProgress = timeSinceWave / WAVE_PASS_MS;
      const p            = 1 - passProgress;

      currentRadius = waveRmin + p * p * p * (waveRmax - waveRmin);
      waveVisible   = true;

      const opFade  = Math.min(passProgress * 6, 1) * Math.min((1 - passProgress) * 6, 1);
      waveOpacity   = WAVE_OP_MIN + opFade * (WAVE_OP_MAX - WAVE_OP_MIN);

      const dotAppear = Math.max(0, (passProgress - 0.85) / 0.15);
      dotAlpha        = dotAppear * dotAppear;
      symbolAlpha     = 0;
      labelAlpha      = 0;
    } else if (timeSinceWave < SETTLE_MS) {
      const rawFrac     = (timeSinceWave - WAVE_PASS_MS) / (SETTLE_MS - WAVE_PASS_MS);
      const expandStart = 0.35;
      const settleMs    = timeSinceWave - WAVE_PASS_MS;
      const morphStart  = DOT_HOLD_MS;
      const morphEnd    = DOT_HOLD_MS + MORPH_DUR_MS;

      // drive outward pulse rings once the arrow is fully visible
      const pulseStart = morphEnd + LABEL_DELAY_MS + LABEL_DUR_MS;
      if (settleMs > pulseStart) {
        const pt = ((settleMs - pulseStart) % 1800) / 1800; // 0→1 every 1.8 s
        pulseRadius = pt * 60;                               // expands 0 → 60 px
        pulseAlpha  = smoothstep(1 - pt);                   // fades out as it grows
      } else {
        pulseAlpha = 0;
      }
      const labelStart  = morphEnd + LABEL_DELAY_MS;
      const labelEnd    = labelStart + LABEL_DUR_MS;
      const holdTotalMs = (SETTLE_MS - WAVE_PASS_MS) * 0.35;

      dotAlpha = settleMs < morphStart ? 1
        : settleMs < morphEnd ? 1 - smoothstep((settleMs - morphStart) / MORPH_DUR_MS)
        : 0;

      symbolAlpha = settleMs < morphStart ? 0
        : settleMs < morphEnd ? smoothstep((settleMs - morphStart) / MORPH_DUR_MS)
        : settleMs < holdTotalMs * 0.85 ? 1
        : Math.max(0, 1 - (settleMs - holdTotalMs * 0.85) / (holdTotalMs * 0.15));

      labelAlpha = settleMs < labelStart ? 0
        : settleMs < labelEnd ? smoothstep((settleMs - labelStart) / LABEL_DUR_MS)
        : settleMs < holdTotalMs * 0.85 ? 1
        : Math.max(0, 1 - (settleMs - holdTotalMs * 0.85) / (holdTotalMs * 0.15));

      if (rawFrac < expandStart) {
        currentRadius = waveRmin;
      } else {
        const expandP = ((rawFrac - expandStart) / (1 - expandStart)) ** 2;
        currentRadius = waveRmin + expandP * (waveRmax - waveRmin);
      }
      waveVisible = false;
    } else {
      currentRadius = -1;
      waveVisible   = false;
      dotAlpha = symbolAlpha = labelAlpha = 0;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.lineCap   = 'round';
    ctx.lineWidth = stackedLayout ? 2.2 : DASH_W;

    const hlen        = (stackedLayout ? 5.0 : DASH_L) * 0.5;
    const mouseRadius = 150;
    const spacing     = getSpacing();
    const sweepAngle  = Math.PI * 0.25;
    const cosSweep    = Math.cos(sweepAngle);
    const sinSweep    = Math.sin(sweepAngle);

    for (let i = 0, n = grid.length; i < n; i++) {
      const gx   = grid[i].x;
      const gy   = grid[i].y;
      const seed = grid[i].seed || 0.5;

      if (gx < -spacing || gx > W + spacing) continue;
      if (gy < -spacing || gy > H + spacing) continue;

      let angle = fieldAngle(gx, gy, t);

      /* ── Mouse repulsion ── */
      if (mActive) {
        const mdx = gx - MX;
        const mdy = gy - MY;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < mouseRadius * mouseRadius) {
          const mfo = (1 - Math.sqrt(md2) / mouseRadius) ** 2;
          angle += Math.atan2(mdy, mdx) * mfo * 0.55;
        }
      }

      /* ── Diagonal sweep: teal color + gentle alignment ── */
      const sweep = dashWaveInfluence(gx, gy, timeSinceWave);
      if (sweep.align > 0.001) {
        const ca = Math.cos(angle), sa = Math.sin(angle);
        angle = Math.atan2(
          sa * (1 - sweep.align) + sinSweep * sweep.align,
          ca * (1 - sweep.align) + cosSweep * sweep.align
        );
      }

      /* ── Circle closing-in: calm alignment inside shrinking ring ── */
      const cAlign = circleWaveAlign(gx, gy, currentRadius);
      if (cAlign > 0.001) {
        const calmAngle = fieldAngle(gx * 0.3, gy * 0.3, t * 0.4);
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const cb = Math.cos(calmAngle), sb = Math.sin(calmAngle);
        angle = Math.atan2(
          sa * (1 - cAlign) + sb * cAlign,
          ca * (1 - cAlign) + cb * cAlign
        );
      }

      const baseOp = dashOpacity(gx, seed, gy);
      const opacity = Math.min(baseOp + sweep.teal * 0.28, 1);

      // Gold proximity — dashes within 90 px of the decision point warm to gold
      // as the circle finishes converging (currentRadius shrinks toward 0)
      let goldProx = 0;
      if (currentRadius >= 0 && currentRadius < 90) {
        const gdx  = gx - waveCx;
        const gdy  = gy - waveCy;
        const gdst = Math.sqrt(gdx * gdx + gdy * gdy);
        const nearness  = smoothstep(1 - gdst / 90);
        const converged = smoothstep(1 - currentRadius / 90);
        goldProx = nearness * converged;
      }

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const x0   = gx - cosA * hlen;
      const y0   = gy - sinA * hlen;
      const x1   = gx + cosA * hlen;
      const y1   = gy + sinA * hlen;

      /* ── Circle clipping ── */
      let drawX0 = x0, drawY0 = y0, drawX1 = x1, drawY1 = y1;
      let shouldDraw = true;

      if (currentRadius > 0) {
        const dx  = x1 - x0, dy = y1 - y0;
        const fx  = x0 - waveCx, fy = y0 - waveCy;
        const R2  = currentRadius * currentRadius;
        const p0in = fx * fx + fy * fy <= R2;
        const ex  = x1 - waveCx, ey = y1 - waveCy;
        const p1in = ex * ex + ey * ey <= R2;
        const a   = dx * dx + dy * dy;
        const b   = 2 * (fx * dx + fy * dy);
        const c   = fx * fx + fy * fy - R2;
        const disc = b * b - 4 * a * c;

        if (!p0in && !p1in) {
          shouldDraw = false;
        } else if (!(p0in && p1in)) {
          if (disc < 0) {
            shouldDraw = false;
          } else {
            const sq    = Math.sqrt(disc);
            const t1    = (-b - sq) / (2 * a);
            const t2    = (-b + sq) / (2 * a);
            const tClip = Math.max(0, Math.min(1, p0in ? Math.max(t1, t2) : Math.min(t1, t2)));
            if (p0in) { drawX1 = x0 + tClip * dx; drawY1 = y0 + tClip * dy; }
            else       { drawX0 = x0 + tClip * dx; drawY0 = y0 + tClip * dy; }
          }
        }
      }

      if (!shouldDraw) continue;

      ctx.globalAlpha = opacity;
      ctx.strokeStyle = dashColor(gx, gy, seed, t, sweep.teal, goldProx);
      ctx.beginPath();
      ctx.moveTo(drawX0, drawY0);
      ctx.lineTo(drawX1, drawY1);
      ctx.stroke();
    }

    /* ── Wave ring — teal glow halo + sharp inner edge ── */
    /* ── Wave ring — clean ring, no glow ── */
if (waveVisible && waveOpacity > 0 && currentRadius > 0) {
  ctx.globalAlpha = waveOpacity;
  ctx.strokeStyle = '#0F2A6B';
  ctx.lineWidth   = WAVE_STROKE;
  ctx.lineCap     = 'butt';
  ctx.beginPath();
  ctx.arc(waveCx, waveCy, currentRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineCap = 'round';
}

    /* ── Dot — gold with concentric glow ── */
    if (dotAlpha > 0) {
      // outer halo ring
      ctx.globalAlpha = dotAlpha * 0.18;
      ctx.strokeStyle = '#C6A86A';
      ctx.lineWidth   = 1.0;
      ctx.lineCap     = 'butt';
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS + 14, 0, Math.PI * 2);
      ctx.stroke();
      // mid ring
      ctx.globalAlpha = dotAlpha * 0.42;
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineCap     = 'round';
      // solid gold dot
      ctx.globalAlpha = dotAlpha;
      ctx.fillStyle   = '#C6A86A';
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ── Arrow symbol — gold, punchy ── */
    if (symbolAlpha > 0) {
      const s  = 0.72;
      const ox = waveCx - 15 * s;
      const oy = waveCy - 15 * s;
      ctx.globalAlpha = symbolAlpha;
      ctx.strokeStyle = '#E8C97A';
      ctx.lineWidth   = 2.8;
      ctx.lineCap     = 'square';
      ctx.lineJoin    = 'miter';
      ctx.miterLimit  = 10;
      ctx.beginPath();
      ctx.moveTo(ox + 7 * s, oy + 5 * s);
      ctx.lineTo(ox + 23 * s, oy + 15 * s);
      ctx.lineTo(ox + 7 * s, oy + 25 * s);
      ctx.stroke();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';
    }

    /* ── Label ── */
    if (labelAlpha > 0) {
      const s        = 0.72;
      const label    = 'DECISION, MADE.';
      const isNarrow = W <= 420;
      ctx.globalAlpha  = labelAlpha;
      ctx.fillStyle    = '#C6A86A';
      ctx.font         = isNarrow
        ? '500 10px "IBM Plex Mono", monospace'
        : '500 11px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';
      const step = isNarrow ? 1.2 : 1.9;
      let labelWidth = 0;
      for (let i = 0; i < label.length; i++) labelWidth += ctx.measureText(label[i]).width + step;
      let labelX, labelY;
      if (stackedLayout && isNarrow) {
        labelX = Math.max(16, Math.min(waveCx - labelWidth * 0.5, W - labelWidth - 16));
        labelY = waveCy + 26;
      } else {
        labelX = Math.max(16, Math.min(waveCx + (23 - 15) * s + 10, W - labelWidth - 16));
        labelY = waveCy;
      }
      ctx.save();
      let lx = labelX;
      for (let li = 0; li < label.length; li++) {
        ctx.fillText(label[li], lx, labelY);
        lx += ctx.measureText(label[li]).width + step;
      }
      ctx.restore();
    }

    /* ── Pulse rings — ripple outward from decision point ── */
    if (pulseAlpha > 0 && pulseRadius > 0) {
      ctx.globalAlpha = pulseAlpha * 0.55;
      ctx.strokeStyle = '#C6A86A';
      ctx.lineWidth   = 1.0;
      ctx.lineCap     = 'butt';
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS + pulseRadius, 0, Math.PI * 2);
      ctx.stroke();
      // second ring, offset by half a cycle
      const pt2 = ((pulseRadius / 60) + 0.5) % 1;
      ctx.globalAlpha = smoothstep(1 - pt2) * 0.3;
      ctx.beginPath();
      ctx.arc(waveCx, waveCy, DOT_RADIUS + pt2 * 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineCap = 'round';
    }

    ctx.globalAlpha = 1;
  }

  /* ── Boot ─────────────────────────────────── */
  if (resize()) computeWaveGeometry();
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