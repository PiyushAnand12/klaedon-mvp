let _instance = null;

export function initDecisionEngine() {
  if (_instance) {
    _instance.cleanup();
    _instance = null;
  }

  const canvas = document.getElementById('di-canvas');
  if (!canvas) return () => {};

  const CX = canvas.getContext('2d');
  if (!CX) return () => {};

  /* ── State ────────────────────────────────── */
  let W = 0;
  let H = 0;
  let S = 1;
  let cx = 0;
  let cy = 0;
  let DPR = 1;
  let precA = 0;
  let floatT = 0;
  let lastTs = null;
  let rafId = null;
  let resizeTimer = null;
  let ro = null;

  /* ── Constants ────────────────────────────── */
  const NF = 48;
  const FOV = 440;
  const VX = -0.22;
  const MAX_W = 520;
  const ASPECT = 1.5;
  const FLOAT_SPEED = 1.0;
  const ROTATION_SPEED = 0.072; // radians/sec

  /* ── Sizing ───────────────────────────────── */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);

    const wrap = canvas.parentElement;
    if (!wrap) return;

    const measuredW = wrap.getBoundingClientRect().width || 0;
    if (measuredW <= 0) return;

    W = Math.min(measuredW, MAX_W);
    H = Math.round(W * ASPECT);

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    CX.setTransform(DPR, 0, 0, DPR, 0, 0);

    cx = W * 0.5;
    cy = H * 0.58;
    S = W / 500;

    // Prevent stale delta after resize/orientation changes
    lastTs = null;
  }

  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
    }, 80);
  }

  if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
    ro = new ResizeObserver(scheduleResize);
    ro.observe(canvas.parentElement);
  }

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  /* ── Math helpers ─────────────────────────── */
  function rX(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  }

  function rY(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
  }

  function tf(raw, fy) {
    let p = [raw[0] * S, raw[1] * S, raw[2] * S];
    p = rY(p, precA);
    p = rX(p, VX);
    p[1] += fy;
    return p;
  }

  function proj(p) {
    const sc = FOV / (FOV + p[2]);
    return [cx + p[0] * sc, cy - p[1] * sc];
  }

  function vd(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function vn(v) {
    const l = Math.sqrt(vd(v, v)) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  /* ── Lighting ─────────────────────────────── */
  const KL = vn([0.52, 0.68, 0.44]);
  const RL = vn([-0.48, 0.28, -0.34]);
  const EY = vn([0, Math.sin(-VX), Math.cos(-VX)]);
  const AMB = 0.52;
  const KS = 0.68;
  const RS = 0.20;
  const SPW = 9;
  const SPS = 1.0;

  function calcLight(nx, ny, nz) {
    let n = rY([nx, ny, nz], precA);
    n = rX(n, VX);
    const kd = Math.max(0, vd(n, KL));
    const rd = Math.max(0, vd(n, RL));
    const hv = vn([KL[0] + EY[0], KL[1] + EY[1], KL[2] + EY[2]]);
    const sp = Math.pow(Math.max(0, vd(n, hv)), SPW) * SPS;
    return { d: Math.min(1.45, AMB + kd * KS + rd * RS), sp };
  }

  function applyLit(lit, r, g, b) {
    const f = lit.d;
    const s = Math.min(1, lit.sp);
    return [
      Math.min(255, Math.round(r * f + 252 * s)),
      Math.min(255, Math.round(g * f + 246 * s)),
      Math.min(255, Math.round(b * f + 215 * s)),
    ];
  }

  /* ── Face queue ───────────────────────────── */
  let Q = [];

  function enq(pts, nx, ny, nz, r, g, b, meta, fy) {
    let zs = 0;
    for (let i = 0; i < pts.length; i++) zs += tf(pts[i], fy)[2];
    Q.push({
      pts,
      nx,
      ny,
      nz,
      r,
      g,
      b,
      meta: meta || {},
      fy,
      z: zs / pts.length,
    });
  }

  function drawFace(f) {
    const p2 = f.pts.map((p) => proj(tf(p, f.fy)));

    if (p2.length >= 3) {
      const ax = p2[1][0] - p2[0][0];
      const ay = p2[1][1] - p2[0][1];
      const bx = p2[2][0] - p2[0][0];
      const by = p2[2][1] - p2[0][1];
      if (ax * by - ay * bx > 0) return;
    }

    const lit = calcLight(f.nx, f.ny, f.nz);
    const c = applyLit(lit, f.r, f.g, f.b);

    CX.beginPath();
    CX.moveTo(p2[0][0], p2[0][1]);
    for (let k = 1; k < p2.length; k++) CX.lineTo(p2[k][0], p2[k][1]);
    CX.closePath();
    CX.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    CX.fill();

    if (f.meta.rim) {
      CX.strokeStyle = 'rgba(12,10,28,0.50)';
      CX.lineWidth = 0.6 * S;
      CX.stroke();
    }

    if (lit.sp > 0.04 && p2.length === 4 && !f.meta.rim) {
      const gy = CX.createLinearGradient(p2[3][0], p2[3][1], p2[0][0], p2[0][1]);
      const sa = Math.min(0.68, lit.sp * 0.78).toFixed(3);
      gy.addColorStop(0, `rgba(255,253,225,${sa})`);
      gy.addColorStop(0.5, `rgba(255,251,210,${(lit.sp * 0.14).toFixed(3)})`);
      gy.addColorStop(1, 'rgba(255,251,210,0)');

      CX.beginPath();
      CX.moveTo(p2[0][0], p2[0][1]);
      for (let k = 1; k < p2.length; k++) CX.lineTo(p2[k][0], p2[k][1]);
      CX.closePath();
      CX.fillStyle = gy;
      CX.fill();
    }

    if (f.meta.gr && p2.length === 4) {
      CX.strokeStyle = 'rgba(0,0,18,0.16)';
      CX.lineWidth = 0.24 * S;

      for (let g = 1; g <= f.meta.gr; g++) {
        const t = g / (f.meta.gr + 1);
        CX.beginPath();
        CX.moveTo(
          p2[0][0] + (p2[3][0] - p2[0][0]) * t,
          p2[0][1] + (p2[3][1] - p2[0][1]) * t
        );
        CX.lineTo(
          p2[1][0] + (p2[2][0] - p2[1][0]) * t,
          p2[1][1] + (p2[2][1] - p2[1][1]) * t
        );
        CX.stroke();
      }
    }
  }

  /* ── Geometry primitives ──────────────────── */
  function frus(yB, yT, rB, rT, r, g, b, meta, fy) {
    const dr = rT - rB;
    const dy = yT - yB;
    const L = Math.sqrt(dr * dr + dy * dy) || 1;
    const sn = -dr / L;
    const sl = dy / L;

    for (let i = 0; i < NF; i++) {
      const a0 = (i / NF) * Math.PI * 2;
      const a1 = ((i + 1) / NF) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;

      enq(
        [
          [rB * Math.cos(a0), yB, rB * Math.sin(a0)],
          [rB * Math.cos(a1), yB, rB * Math.sin(a1)],
          [rT * Math.cos(a1), yT, rT * Math.sin(a1)],
          [rT * Math.cos(a0), yT, rT * Math.sin(a0)],
        ],
        sl * Math.cos(am),
        sn,
        sl * Math.sin(am),
        r,
        g,
        b,
        meta,
        fy
      );
    }
  }

  function discU(y, rO, rI, r, g, b, fy) {
    for (let i = 0; i < NF; i++) {
      const a0 = (i / NF) * Math.PI * 2;
      const a1 = ((i + 1) / NF) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);

      enq(
        rI > 0.5
          ? [
              [rO * c0, y, rO * s0],
              [rO * c1, y, rO * s1],
              [rI * c1, y, rI * s1],
              [rI * c0, y, rI * s0],
            ]
          : [
              [0, y, 0],
              [rO * c0, y, rO * s0],
              [rO * c1, y, rO * s1],
            ],
        0,
        1,
        0,
        r,
        g,
        b,
        {},
        fy
      );
    }
  }

  function chamf(yTop, rO, rI, r, g, b, fy) {
    const sq2 = 1 / Math.sqrt(2);

    for (let i = 0; i < NF; i++) {
      const a0 = (i / NF) * Math.PI * 2;
      const a1 = ((i + 1) / NF) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;

      enq(
        [
          [rO * Math.cos(a0), yTop - 5, rO * Math.sin(a0)],
          [rO * Math.cos(a1), yTop - 5, rO * Math.sin(a1)],
          [rI * Math.cos(a1), yTop, rI * Math.sin(a1)],
          [rI * Math.cos(a0), yTop, rI * Math.sin(a0)],
        ],
        sq2 * Math.cos(am),
        sq2,
        sq2 * Math.sin(am),
        r,
        g,
        b,
        { rim: true },
        fy
      );
    }
  }

  function bolts(y, rad, n, r0, g0, b0, fy) {
    const h = 4;
    const d = 4;
    const hw = (Math.PI * 2 / n) * 0.11;

    for (let i = 0; i < n; i++) {
      const ac = (i / n) * Math.PI * 2;
      const a0 = ac - hw;
      const a1 = ac + hw;
      const ri = rad;
      const ro = rad + d;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const cm = Math.cos(ac);
      const sm = Math.sin(ac);

      enq(
        [
          [ri * c0, y + h, ri * s0],
          [ri * c1, y + h, ri * s1],
          [ro * c1, y + h, ro * s1],
          [ro * c0, y + h, ro * s0],
        ],
        0,
        1,
        0,
        r0,
        g0,
        b0,
        { rim: true },
        fy
      );

      enq(
        [
          [ro * c0, y, ro * s0],
          [ro * c1, y, ro * s1],
          [ro * c1, y + h, ro * s1],
          [ro * c0, y + h, ro * s0],
        ],
        cm,
        0,
        sm,
        r0,
        g0,
        b0,
        {},
        fy
      );
    }
  }

  function ring(yT, rO, rI, th, rL, gL, bL, rD, gD, bD, nBolts, fy) {
    const yB = yT - th;
    const rLip = rO + 4;

    discU(yT, rLip, 0, rL, gL, bL, fy);
    frus(yT - 6, yT, rO, rLip, rD, gD, bD, { rim: true }, fy);
    chamf(yT, rLip, rO, rL, gL, bL, fy);
    frus(yB, yT - 6, rO, rO, rL, gL, bL, { gr: 3 }, fy);
    frus(yB - 4, yB, rO - 3, rO, rD, gD, bD, { rim: true }, fy);
    discU(yB, rO, rI, rL, gL, bL, fy);

    const yFloor = yB - th * 0.5;
    for (let ii = 0; ii < NF; ii++) {
      const a0 = (ii / NF) * Math.PI * 2;
      const a1 = ((ii + 1) / NF) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;

      enq(
        [
          [rI * Math.cos(a1), yB, rI * Math.sin(a1)],
          [rI * Math.cos(a0), yB, rI * Math.sin(a0)],
          [rI * Math.cos(a0), yFloor, rI * Math.sin(a0)],
          [rI * Math.cos(a1), yFloor, rI * Math.sin(a1)],
        ],
        -Math.cos(am),
        0,
        -Math.sin(am),
        rD,
        gD,
        bD,
        {},
        fy
      );
    }

    discU(yFloor, rI, 0, rD, gD, bD, fy);
    if (nBolts > 0) bolts(yB, rI + 4, nBolts, rD, gD, bD, fy);
  }

  /* ── Render loop ──────────────────────────── */
  function render(ts) {
    rafId = requestAnimationFrame(render);

    if (!W || !H) return;

    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;

    floatT += dt * FLOAT_SPEED;
    precA += dt * ROTATION_SPEED;

    CX.clearRect(0, 0, W, H);
    Q = [];

    const fy = Math.sin(floatT * 0.44) * 5 * S;

    const LT = [210, 208, 220];
    const MD = [172, 170, 182];
    const DK = [130, 128, 140];
    const SP = [82, 80, 94];
    const GD = [218, 182, 112];
    const GDB = [172, 140, 80];
    const GDL = [242, 212, 152];

    frus(-220, 196, 3, 3, SP[0], SP[1], SP[2], {}, fy);

    ring(196, 120, 96, 52, LT[0], LT[1], LT[2], DK[0], DK[1], DK[2], 12, fy);
    ring(144, 92, 74, 44, MD[0], MD[1], MD[2], DK[0], DK[1], DK[2], 10, fy);
    ring(100, 70, 56, 38, LT[0], LT[1], LT[2], DK[0], DK[1], DK[2], 8, fy);
    ring(62, 52, 42, 32, MD[0], MD[1], MD[2], DK[0], DK[1], DK[2], 7, fy);
    ring(30, 38, 30, 26, LT[0], LT[1], LT[2], DK[0], DK[1], DK[2], 6, fy);

    frus(4, 14, 24, 26, GD[0], GD[1], GD[2], { rim: true }, fy);
    discU(14, 26, 18, GD[0], GD[1], GD[2], fy);
    chamf(14, 28, 24, GDL[0], GDL[1], GDL[2], fy);
    frus(-4, 4, 22, 24, GDB[0], GDB[1], GDB[2], {}, fy);
    discU(-4, 22, 16, GD[0], GD[1], GD[2], fy);
    bolts(14, 18, 8, GDB[0], GDB[1], GDB[2], fy);

    frus(-14, -4, 16, 17, MD[0], MD[1], MD[2], {}, fy);
    discU(-14, 17, 12, LT[0], LT[1], LT[2], fy);
    chamf(-14, 17, 13, MD[0], MD[1], MD[2], fy);
    frus(-26, -14, 12, 12, DK[0], DK[1], DK[2], {}, fy);
    discU(-26, 12, 8, LT[0], LT[1], LT[2], fy);
    frus(-40, -26, 8, 9, MD[0], MD[1], MD[2], {}, fy);
    discU(-40, 9, 0, LT[0], LT[1], LT[2], fy);

    frus(-220, -40, 0, 9, DK[0], DK[1], DK[2], {}, fy);

    Q.sort((a, b) => a.z - b.z);

    /* Drop shadow behind all faces */
    const sp = proj(tf([0, -222, 0], fy));
    const sg = CX.createRadialGradient(sp[0], sp[1] + 10 * S, 0, sp[0], sp[1] + 10 * S, 60 * S);
    sg.addColorStop(0, 'rgba(0,0,0,0.18)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    CX.beginPath();
    CX.ellipse(sp[0], sp[1] + 10 * S, 58 * S, 10 * S, 0, 0, Math.PI * 2);
    CX.fillStyle = sg;
    CX.fill();

    Q.forEach(drawFace);

    const tp = proj(tf([0, -222, 0], fy));
    const gg = CX.createRadialGradient(tp[0], tp[1], 0, tp[0], tp[1], 10 * S);
    gg.addColorStop(0, 'rgba(228,192,100,0.72)');
    gg.addColorStop(1, 'rgba(228,192,80,0)');
    CX.beginPath();
    CX.arc(tp[0], tp[1], 10 * S, 0, Math.PI * 2);
    CX.fillStyle = gg;
    CX.fill();

    CX.beginPath();
    CX.arc(tp[0], tp[1], 2.8 * S, 0, Math.PI * 2);
    CX.fillStyle = 'rgba(248,218,130,0.92)';
    CX.fill();

    const r1p = proj(tf([98, 196, 0], fy));
    const rg = CX.createRadialGradient(r1p[0], r1p[1], 0, r1p[0], r1p[1], 46 * S);
    rg.addColorStop(0, 'rgba(255,255,252,0.20)');
    rg.addColorStop(1, 'rgba(255,255,252,0)');
    CX.beginPath();
    CX.arc(r1p[0], r1p[1], 46 * S, 0, Math.PI * 2);
    CX.fillStyle = rg;
    CX.fill();
  }

  /* ── Boot ─────────────────────────────────── */
  resize();
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
    window.removeEventListener('resize', scheduleResize);
    window.removeEventListener('orientationchange', scheduleResize);
    _instance = null;
  }

  _instance = { cleanup };
  return cleanup;
}