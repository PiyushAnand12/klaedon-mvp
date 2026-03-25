/* ════════════════════════════════════════════
   UNFILTERED MARKET DATA — di-canvas visualiser
   Drop-in replacement for initDiCanvas / equity chart.
   Call initUnfilteredCanvas() from main.js.
════════════════════════════════════════════ */

export function initUnfilteredCanvas() {
  const canvas = document.getElementById('di-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  /* ── Brand colors ─────────────────────── */
  const C_NODE  = '26,58,110';    // navy
  const C_EDGE  = '26,58,110';    // navy edges
  const C_GOLD  = '198,168,106';  // gold for a few accent nodes
  const C_LABEL = '26,58,110';

  /* ── Sizing ───────────────────────────── */
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  function resize() {
    const container = canvas.parentElement;
    const cw = container ? container.clientWidth : 420;
    W = Math.min(cw, 480);
    H = Math.round(W * 1.1);  // portrait-ish
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  resize();
  window.addEventListener('resize', () => { resize(); rebuildNodes(); });

  /* ── Nodes ────────────────────────────── */
  let nodes = [];
  const NODE_COUNT = 72;
  const CONNECT_DIST = 90;

  function rebuildNodes() {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      const isGold = Math.random() < 0.08; // ~8% gold accent
      nodes.push({
        x:     Math.random() * W,
        y:     Math.random() * H,
        vx:    (Math.random() - 0.5) * 0.5,
        vy:    (Math.random() - 0.5) * 0.5,
        r:     isGold ? 2.5 + Math.random() * 1.5 : 1.5 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
        gold:  isGold,
        // random extra velocity for chaotic feel
        chaos: 0.4 + Math.random() * 0.6,
      });
    }
  }

  rebuildNodes();

  /* ── Animate ──────────────────────────── */
  let rafId = null;

  function animate() {
    rafId = requestAnimationFrame(animate);
    ctx.clearRect(0, 0, W, H);

    // Update
    nodes.forEach(n => {
      n.x     += n.vx * n.chaos;
      n.y     += n.vy * n.chaos;
      n.phase += 0.018;
      if (n.x < 0 || n.x > W) { n.vx *= -1; n.x = Math.max(0, Math.min(W, n.x)); }
      if (n.y < 0 || n.y > H) { n.vy *= -1; n.y = Math.max(0, Math.min(H, n.y)); }
    });

    // Edges
    ctx.lineCap = 'round';
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx   = nodes[j].x - nodes[i].x;
        const dy   = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < CONNECT_DIST) {
          const a  = (1 - dist / CONNECT_DIST) * 0.14;
          const ni = nodes[i], nj = nodes[j];
          // gold-edge if either node is gold
          const c = (ni.gold || nj.gold) ? C_GOLD : C_EDGE;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${c},${(ni.gold || nj.gold) ? a * 1.8 : a})`;
          ctx.lineWidth   = (ni.gold || nj.gold) ? 1.0 : 0.75;
          ctx.moveTo(ni.x, ni.y);
          ctx.lineTo(nj.x, nj.y);
          ctx.stroke();
        }
      }
    }

    // Nodes
    nodes.forEach(n => {
      const pulse = 0.3 + Math.sin(n.phase) * 0.18;
      if (n.gold) {
        // Gold nodes: filled dot + outer ring
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${C_GOLD},${pulse * 0.4})`;
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${C_GOLD},${pulse + 0.2})`;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${C_NODE},${pulse})`;
        ctx.fill();
      }
    });

    // Label
    ctx.font         = '500 9px "IBM Plex Mono", monospace';
    ctx.fillStyle    = `rgba(${C_LABEL},0.28)`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.letterSpacing = '0.22em';
    ctx.fillText('UNFILTERED MARKET DATA', W / 2, H - 10);
    ctx.letterSpacing = '0';
  }

  /* ── Start on scroll into view ────────── */
  let started = false;

  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !started) {
      started = true;
      animate();
      observer.disconnect();
    }
  }, { threshold: 0.2 });

  observer.observe(canvas);

  /* ── Cleanup ──────────────────────────── */
  return function cleanup() {
    if (rafId) cancelAnimationFrame(rafId);
    observer.disconnect();
  };
}
