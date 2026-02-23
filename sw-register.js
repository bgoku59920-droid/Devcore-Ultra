/**
 * ═══════════════════════════════════════════════════════════
 * DEVCORE ULTRA — Service Worker Registration & PWA Manager
 * Handles SW registration, updates, install prompts,
 * online/offline detection, and cache communication
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ─── PWA MANAGER ─── */
const DevCorePWA = (() => {

  let deferredInstallPrompt = null;
  let swRegistration = null;
  let isOnline = navigator.onLine;

  /* ── Register Service Worker ── */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[Devcore PWA] Service Workers not supported.');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register(
        '/service-worker.js',
        {
          scope: '/',
          updateViaCache: 'none', // Always check for SW updates
        }
      );

      swRegistration = registration;
      console.log('[Devcore PWA] Service Worker registered:', registration.scope);

      /* Handle SW lifecycle states */
      registration.addEventListener('updatefound', onUpdateFound);

      /* Check for updates periodically (every 30 min) */
      setInterval(() => {
        registration.update();
        console.log('[Devcore PWA] Checking for SW update...');
      }, 30 * 60 * 1000);

      /* If SW is already active on first load */
      if (registration.active) {
        console.log('[Devcore PWA] SW already active.');
      }

      return registration;

    } catch (err) {
      console.error('[Devcore PWA] SW registration failed:', err);
      return null;
    }
  }

  /* ── Handle SW Update Found ── */
  function onUpdateFound() {
    const newWorker = swRegistration.installing;
    if (!newWorker) return;

    console.log('[Devcore PWA] New SW installing...');

    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        console.log('[Devcore PWA] New SW installed, update available.');
        notifyAppOfUpdate();
      }
    });
  }

  /* ── Notify App That Update Is Ready ── */
  function notifyAppOfUpdate() {
    /* Dispatch custom event that the main app can listen to */
    window.dispatchEvent(new CustomEvent('devcore-sw-update', {
      detail: { message: 'A new version is available.' }
    }));
  }

  /* ── Apply Update (skip waiting) ── */
  function applyUpdate() {
    if (!swRegistration?.waiting) return;
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }

  /* ── Handle Controlled Change (new SW took control) ── */
  function setupControlledChange() {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[Devcore PWA] New SW took control. Reloading...');
        window.location.reload();
      }
    });
  }

  /* ── Online / Offline Detection ── */
  function setupNetworkDetection() {
    window.addEventListener('online', () => {
      isOnline = true;
      console.log('[Devcore PWA] Back online.');
      window.dispatchEvent(new CustomEvent('devcore-network-change', {
        detail: { online: true }
      }));
    });

    window.addEventListener('offline', () => {
      isOnline = false;
      console.log('[Devcore PWA] Gone offline.');
      window.dispatchEvent(new CustomEvent('devcore-network-change', {
        detail: { online: false }
      }));
    });
  }

  /* ── Install Prompt (Add to Home Screen) ── */
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      console.log('[Devcore PWA] Install prompt captured.');
      // Notify app
      window.dispatchEvent(new CustomEvent('devcore-install-available'));
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      console.log('[Devcore PWA] App installed successfully.');
      window.dispatchEvent(new CustomEvent('devcore-app-installed'));
    });
  }

  /* ── Trigger Install Prompt ── */
  async function promptInstall() {
    if (!deferredInstallPrompt) {
      console.warn('[Devcore PWA] No install prompt available.');
      return false;
    }
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    console.log('[Devcore PWA] Install prompt result:', result.outcome);
    deferredInstallPrompt = null;
    return result.outcome === 'accepted';
  }

  /* ── Send Message to SW ── */
  function sendMessage(type, payload = null) {
    return new Promise((resolve, reject) => {
      if (!navigator.serviceWorker.controller) {
        reject(new Error('No SW controller'));
        return;
      }

      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.success) resolve(event.data);
        else reject(event.data);
      };

      navigator.serviceWorker.controller.postMessage(
        { type, payload },
        [channel.port2]
      );
    });
  }

  /* ── Get Cache Status ── */
  async function getCacheStatus() {
    try {
      return await sendMessage('GET_CACHE_STATUS');
    } catch {
      return null;
    }
  }

  /* ── Clear All Caches ── */
  async function clearCache() {
    try {
      return await sendMessage('CLEAR_CACHE');
    } catch {
      return null;
    }
  }

  /* ── Check Display Mode ── */
  function getDisplayMode() {
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
    if (window.navigator.standalone === true) return 'standalone-ios';
    return 'browser';
  }

  /* ── Check if Running as PWA ── */
  function isPWA() {
    const mode = getDisplayMode();
    return mode === 'standalone' || mode === 'standalone-ios' || mode === 'fullscreen';
  }

  /* ── Init ── */
  async function init() {
    console.log('[Devcore PWA] Initializing PWA Manager...');
    setupNetworkDetection();
    setupInstallPrompt();
    setupControlledChange();

    /* Wait for page load before registering SW */
    if (document.readyState === 'complete') {
      await registerSW();
    } else {
      window.addEventListener('load', async () => {
        await registerSW();
      });
    }

    console.log('[Devcore PWA] Display mode:', getDisplayMode());
    console.log('[Devcore PWA] Is PWA:', isPWA());
    console.log('[Devcore PWA] Online:', isOnline);
  }

  /* ── Public API ── */
  return {
    init,
    registerSW,
    promptInstall,
    applyUpdate,
    getCacheStatus,
    clearCache,
    getDisplayMode,
    isPWA,
    get isOnline() { return isOnline; },
    get registration() { return swRegistration; },
    get canInstall() { return !!deferredInstallPrompt; },
  };

})();

/* ─── AUTO INIT ─── */
DevCorePWA.init();

/* ─── LISTEN FOR APP-LEVEL EVENTS ─── */

/* SW Update available */
window.addEventListener('devcore-sw-update', () => {
  console.log('[Devcore PWA] Update event received by app.');
  /* The main app can hook into this to show an update modal */
  if (typeof window.onDevcoreUpdate === 'function') {
    window.onDevcoreUpdate();
  }
});

/* Network change */
window.addEventListener('devcore-network-change', (e) => {
  const { online } = e.detail;
  if (typeof window.onDevcoreNetworkChange === 'function') {
    window.onDevcoreNetworkChange(online);
  }
});

/* Install available */
window.addEventListener('devcore-install-available', () => {
  if (typeof window.onDevcoreInstallAvailable === 'function') {
    window.onDevcoreInstallAvailable();
  }
});

/* App installed */
window.addEventListener('devcore-app-installed', () => {
  if (typeof window.onDevcoreInstalled === 'function') {
    window.onDevcoreInstalled();
  }
});

/* ─── EXPOSE GLOBALLY ─── */
window.DevCorePWA = DevCorePWA;