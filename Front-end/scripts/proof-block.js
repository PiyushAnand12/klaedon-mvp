/* ════════════════════════════════════════════
   EXAMPLE PROOF MODULE — with transitions
════════════════════════════════════════════ */

export function initExampleProof() {
  const sels    = document.querySelectorAll('.ep-sel');
  const imgs    = document.querySelectorAll('.ep-img');
  const expand  = document.getElementById('ep-expand');
  const lb      = document.getElementById('ep-lightbox');
  const lbImg   = document.getElementById('ep-lb-img');
  const lbClose = document.getElementById('ep-lb-close');
  const lbBack  = document.getElementById('ep-lb-backdrop');

  if (!sels.length || !imgs.length) return;

  let current = 0;
  let transitioning = false;

  // ── Cross-fade transition ────────────────
  function activate(idx) {
    if (idx === current || transitioning) return;
    transitioning = true;

    const outImg = imgs[current];
    const inImg  = imgs[idx];

    // Update selectors immediately
    sels.forEach((s, i) => {
      s.classList.toggle('is-active', i === idx);
      s.setAttribute('aria-selected', String(i === idx));
    });

    // Fade out current
    outImg.classList.add('is-leaving');
    outImg.classList.remove('is-active');

    // Fade in next after a brief overlap window
    requestAnimationFrame(() => {
      inImg.classList.add('is-active');
    });

    // Clean up after transition
    const DURATION = 320;
    setTimeout(() => {
      outImg.classList.remove('is-leaving');
      current = idx;
      transitioning = false;
    }, DURATION);
  }

  sels.forEach(btn => {
    btn.addEventListener('click', () => {
      activate(parseInt(btn.dataset.index, 10));
    });
  });

  // ── Keyboard navigation on selectors ────
  sels.forEach((btn, i) => {
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = Math.min(i + 1, sels.length - 1);
        sels[next].focus();
        activate(next);
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = Math.max(i - 1, 0);
        sels[prev].focus();
        activate(prev);
      }
    });
  });

  // ── Lightbox ─────────────────────────────
  function activeImg() {
    return imgs[current];
  }

  function openLb() {
    const img = activeImg();
    if (!img) return;
    lbImg.src = img.src;
    lbImg.alt = img.alt;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    // Fade lightbox in
    requestAnimationFrame(() => lb.classList.add('is-open'));
    lbClose.focus();
  }

  function closeLb() {
    lb.classList.remove('is-open');
    setTimeout(() => {
      lb.hidden = true;
      document.body.style.overflow = '';
    }, 260);
    expand && expand.focus();
  }

  if (expand) expand.addEventListener('click', openLb);
  if (lbClose) lbClose.addEventListener('click', closeLb);
  if (lbBack)  lbBack.addEventListener('click', closeLb);

  document.addEventListener('keydown', e => {
    if (!lb || lb.hidden) return;
    if (e.key === 'Escape') { closeLb(); return; }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = e.key === 'ArrowRight'
        ? Math.min(current + 1, sels.length - 1)
        : Math.max(current - 1, 0);
      if (next !== current) {
        activate(next);
        const img = activeImg();
        if (img) { lbImg.src = img.src; lbImg.alt = img.alt; }
      }
    }
  });
}