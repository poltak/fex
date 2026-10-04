/** Service worker registration, the update notice, and the install prompt.
 * @param {{onUpdate?: (available: boolean) => void, onInstallAvailable?: (available: boolean) => void, onInstalled?: () => void}} [options] */
export function createPwa({ onUpdate = () => {}, onInstallAvailable = () => {}, onInstalled = () => {} } = {}) {
  let registration;
  /** @type {any} */
  let installPrompt;
  let accepted = false;
  let reloaded = false;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || /** @type {Navigator & {standalone?: boolean}} */ (navigator).standalone === true;
  // An update is available only when this app's active worker has a successor that waits.
  const syncUpdate = () => onUpdate(Boolean(registration?.active && registration.waiting?.state === 'installed'));
  // The worker removes old asset caches when the only open tab runs the worker's build.
  const announceReady = () => {
    if (!document.hidden) navigator.serviceWorker?.controller?.postMessage({ type: 'FEX_CLIENT_READY', version: __FEX_BUILD_ID__ });
  };
  window.addEventListener('focus', announceReady);
  document.addEventListener('visibilitychange', announceReady);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; onInstallAvailable(!isStandalone());
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined; onInstallAvailable(false); onInstalled();
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    syncUpdate();
    // Reload only the tab where the user accepted the update.
    if (accepted && !reloaded) { reloaded = true; window.location.reload(); }
    else announceReady();
  });
  return {
    isStandalone,
    async register() {
      if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
      try {
        registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
        const observe = worker => worker?.addEventListener('statechange', syncUpdate);
        registration.addEventListener('updatefound', () => observe(registration.installing));
        observe(registration.waiting);
        observe(registration.installing);
        syncUpdate();
        announceReady();
      } catch { /* Conversion still works when the browser blocks service workers. */ }
    },
    update() {
      if (!registration?.waiting) { syncUpdate(); return false; }
      accepted = true;
      registration.waiting.postMessage({ type: 'FEX_ACCEPT_UPDATE' });
      return true;
    },
    async install() {
      if (!installPrompt) return false;
      const prompt = installPrompt;
      installPrompt = undefined;
      onInstallAvailable(false);
      await prompt.prompt();
      return (await prompt.userChoice).outcome === 'accepted';
    },
  };
}
