// ---------- The shell of the installable web app (browser only, and only on the web site). ----------
// It owns the service worker that keeps a copy of the app for offline use, new versions, installing, and
// what kind of window this is. The page (ui.js) only talks to window.AppShell and works without it:
// inside a Claude Artifact there is no shell and none of this runs.
(() => {
  const VERSION = '/*VERSION*/', BUILT = '/*BUILT*/';
  const nav = navigator, swc = nav.serviceWorker || null, ua = nav.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const mode = window.matchMedia ? matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)') : null;
  const standalone = () => !!(mode && mode.matches) || nav.standalone === true;
  const AUTO = 'ascend.autoupdate', born = Date.now(), subs = [];
  let reg = null, registering = null, waiting = null, stale = false, applying = false, touched = false, promptEvt = null, lastCheck = 0;
  let controlled = !!(swc && swc.controller);
  const tell = () => { for (const fn of subs) try { fn(); } catch (e) {} };

  const shell = window.AppShell = {
    version: VERSION, built: BUILT, ios,
    get standalone() { return standalone(); },                 // opened from the home screen or as an installed window
    get offline() { return !!(swc && swc.controller); },       // a copy of the app is kept on this device
    get updateReady() { return stale || !!waiting; },          // a newer version is downloaded and waiting
    get canInstall() { return !!promptEvt; },                  // the browser offers its own install window
    onChange(fn) { subs.push(fn); },
    // Looks for a new version now. Answers 'ready' (downloaded, waiting), 'current', 'offline' or 'none' (this browser keeps no copy).
    async check() {
      if (registering) await registering;
      if (stale || waiting) return 'ready';
      if (!reg) return 'none';
      lastCheck = Date.now();
      try { await reg.update(); } catch (e) { return 'offline'; }
      const w = reg.installing || reg.waiting;
      if (w && w.state === 'installing') await new Promise(res => { w.addEventListener('statechange', () => { if (w.state !== 'installing') res(); }); setTimeout(res, 30000); });
      if (w && w.state === 'installed' && swc.controller) found(w);
      return stale || waiting ? 'ready' : 'current';
    },
    // Switches to the waiting version. The page reloads once the new copy has taken over.
    update() {
      if (applying) return;
      applying = true;
      if (stale || !waiting || waiting.state !== 'installed') { location.reload(); return; }
      setTimeout(() => location.reload(), 4000); // in case the handover never reports back
      waiting.postMessage('skip-waiting');
    },
    // Opens the browser's install window, where there is one (Chrome, Edge and Android). An iPhone installs from the Share menu.
    async install() {
      const e = promptEvt;
      if (!e) return false;
      promptEvt = null;
      let ok = false;
      try { e.prompt(); ok = (await e.userChoice).outcome === 'accepted'; } catch (err) {}
      tell();
      return ok;
    },
  };

  // A version that arrives while the app is still opening is switched to at once, so it simply appears.
  // Not after the first tap, and not twice within a minute in case a deploy is half way through.
  function quiet() {
    if (touched || Date.now() - born > 12000) return false;
    try {
      if (Date.now() - (Number(sessionStorage.getItem(AUTO)) || 0) < 60000) return false;
      sessionStorage.setItem(AUTO, String(Date.now()));
    } catch (e) { return false; }
    return true;
  }
  function found(worker) {
    if (waiting === worker) return;
    waiting = worker;
    if (quiet()) shell.update(); else tell();
  }
  function watch(r) {
    reg = r;
    const track = w => { if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && swc.controller) found(w); }); }; // with no controller it is the first copy, not an update
    if (r.waiting && swc.controller) found(r.waiting);
    track(r.installing); // the browser may have started on a new version before this page asked
    r.addEventListener('updatefound', () => track(r.installing));
  }
  if (swc) {
    swc.addEventListener('controllerchange', () => {
      if (!controlled) { controlled = true; tell(); return; } // the first copy taking this page over: nothing changed for it
      if (applying) location.reload();
      else { stale = true; tell(); }                          // another window switched versions: this one is behind until it reloads
    });
    const start = () => { registering = swc.register('sw.js', { scope: './' }).then(watch).catch(() => {}); };
    if (document.readyState === 'complete') start(); else addEventListener('load', start);
    document.addEventListener('visibilitychange', () => { // a home-screen app can stay open for days: look again when it comes back to the front
      if (!document.hidden && reg && Date.now() - lastCheck > 30 * 60000) { lastCheck = Date.now(); reg.update().catch(() => {}); }
    });
  }
  const touch = () => { touched = true; };
  addEventListener('pointerdown', touch, { capture: true, once: true, passive: true });
  addEventListener('keydown', touch, { capture: true, once: true });

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptEvt = e; tell(); });
  addEventListener('appinstalled', () => { promptEvt = null; tell(); });
  if (mode && mode.addEventListener) mode.addEventListener('change', tell);

  // Ask the browser to keep the save even when the device runs short of space. Firefox would put a question on the screen, so it is left out.
  try { if (nav.storage && nav.storage.persist && !/Firefox\//.test(ua)) nav.storage.persisted().then(kept => kept || nav.storage.persist()).catch(() => {}); } catch (e) {}

  // The colour of the browser bar and of the installed window's title bar follows the quest-window theme.
  const tint = document.querySelector('meta[name="theme-color"]');
  const paint = () => { const c = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); if (c && tint) tint.setAttribute('content', c); };
  try { new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] }); } catch (e) {}
})();
