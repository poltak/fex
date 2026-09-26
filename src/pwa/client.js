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
        if (registration.waiting) onUpdate(true);
        const watch = () => {
          const worker = registration.installing;
          if (!worker) return;
          listen(worker, 'statechange', () => {
            if (worker.state === 'installed') {
              if (navigator.serviceWorker.controller) onUpdate(true);
              else onOfflineReady();
            }
          });
        };
        listen(registration, 'updatefound', watch);
        watch();
        announceReady();
      } catch { /* Conversion still works when the browser blocks service workers. */ }
    },
    update() {
      if (!registration?.waiting) return false;
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
