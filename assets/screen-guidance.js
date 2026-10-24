/* Computer-only entry policy. No bypass, storage writes or saved-data migration. */
(() => {
  const dialog = document.getElementById('demo-screen-guidance');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const small = matchMedia(`(max-width: ${Number(dialog.dataset.minWidth) - 1}px), (max-height: ${Number(dialog.dataset.minHeight) - 1}px)`);
  const mobile = navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    matchMedia('(hover: none) and (pointer: coarse)').matches;
  let previousFocus;
  let pausedRun;
  function sync() {
    const blocked = mobile || small.matches;
    document.documentElement.classList.toggle('computer-demo-blocked', blocked);
    if (blocked && !dialog.open) {
      previousFocus = document.activeElement;
      if (window.G?.state === 'running') {
        pausedRun = window.G;
        pausedRun.state = 'paused';
        window.updateHUD?.();
      }
      dialog.showModal();
    } else if (!blocked && dialog.open) {
      dialog.close();
      if (pausedRun === window.G && pausedRun?.state === 'paused') {
        pausedRun.state = 'running';
        window.updateHUD?.();
      }
      pausedRun = null;
      const target = previousFocus?.isConnected && previousFocus !== document.body
        ? previousFocus : document.querySelector(dialog.dataset.focus);
      target?.focus({ preventScroll: true });
    }
  }
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  small.addEventListener('change', sync);
  sync();
})();
