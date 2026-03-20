let _instance = null;

export function initReveal() {
  if (_instance) {
    _instance.cleanup();
    _instance = null;
  }

  const elements = Array.from(
    document.querySelectorAll('.reveal:not(.visible)')
  );

  if (!elements.length) {
    return () => {};
  }

  if (typeof IntersectionObserver === 'undefined') {
    elements.forEach((el) => el.classList.add('visible'));
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  elements.forEach((el) => observer.observe(el));

  function cleanup() {
    observer.disconnect();
    if (_instance?.cleanup === cleanup) {
      _instance = null;
    }
  }

  _instance = { cleanup };
  return cleanup;
}