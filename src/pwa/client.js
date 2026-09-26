/** @param {{onUpdate?: (available: boolean) => void, onInstallAvailable?: (available: boolean) => void, onInstalled?: () => void, onOfflineReady?: () => void}} [options] */
export function createPwa({ onUpdate = () => {}, onInstallAvailable = () => {}, onInstalled = () => {}, onOfflineReady = () => {} } = {}) {
  let registration;
  /** @type {any} */
  let installPrompt;
  let accepted = false;
  let disposed = false;
  let reloaded = false;
  const removers = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    removers.push(() => target.removeEventListener(name, fn));
  };
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || /** @type {Navigator & {standalone?: boolean}} */ (navigator).standalone === true;
  const syncUpdate = () => {
    if (!disposed) onUpdate(Boolean(registration?.active && registration.waiting?.state === 'installed'));
  };
  const announceReady = () => {
    if (!disposed && !document.hidden) navigator.serviceWorker?.controller?.postMessage({ type: 'FEX_CLIENT_READY', version: __FEX_BUILD_ID__ });
  };
  listen(window, 'focus', announceReady);
  listen(document, 'visibilitychange', announceReady);
  listen(window, 'beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; onInstallAvailable(!isStandalone());
  });
  listen(window, 'appinstalled', () => {
    installPrompt = undefined; onInstallAvailable(false); onInstalled();
  });
  if ('serviceWorker' in navigator) listen(navigator.serviceWorker, 'controllerchange', () => {
    syncUpdate();
    if (accepted && !reloaded) { reloaded = true; window.location.reload(); }
    else announceReady();
  });
  return {
    isStandalone,
    async register() {
      if (disposed || !('serviceWorker' in navigator) || !import.meta.env.PROD) return;
      try {
        registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
        if (disposed) return;
        const observe = worker => {
          if (!worker) return;
          listen(worker, 'statechange', () => {
            syncUpdate();
            if (worker.state === 'installed' && !registration.active) onOfflineReady();
          });
        };
        const watch = () => observe(registration.installing);
        listen(registration, 'updatefound', watch);
        observe(registration.waiting);
        watch();
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
    dispose() { disposed = true; removers.splice(0).forEach(remove => remove()); },
  };
}
