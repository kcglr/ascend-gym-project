// Drives the installable web app (dist/site) the way a phone does: served from a folder named after the
// repository, as on GitHub Pages, then installed by its service worker, taken offline, replaced by a new
// deploy, and backed up and restored. Run: node build.js && node tests/pwa.test.js
// Needs Playwright with Chromium. An iPhone is imitated by its browser name only: Safari itself is not run.
// To run some of the tests, give a part of their name: node tests/pwa.test.js "share sheet"
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const serve = require('./serve.js');

const SITE = path.join(__dirname, '..', 'dist', 'site');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const KEY = 'dailyquest.v2';

const ONLY = process.argv[2] || '';
let passed = 0, failed = 0, skipped = 0;
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    if ((await fn()) === 'skip') { skipped++; console.log('  skip ' + name); return; }
    passed++; console.log('  ok   ' + name);
  } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')); }
}

(async () => {
  const site = await serve({ site: true }), URL0 = site.url, BASE = new URL(URL0).pathname;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ascend-pwa-'));
  const VERSION = (fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8').match(/const VERSION = '([0-9a-f]+)'/) || [])[1];
  assert.ok(VERSION, 'dist/site/sw.js names no version. Run node build.js first.');

  // A deploy of a later version: the built site again, under another version. `stalePage` leaves the old page
  // in place, which is what a host looks like while it is half way through a deploy.
  function deploy(version, opts) {
    const dir = path.join(tmp, version + (opts && opts.stalePage ? '-half' : ''));
    fs.cpSync(SITE, dir, { recursive: true });
    for (const f of opts && opts.stalePage ? ['sw.js'] : ['sw.js', 'index.html']) {
      fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8').split(VERSION).join(version));
    }
    return dir;
  }

  const open = [];
  async function start(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({
      viewport: { width: opts.width || 390, height: opts.height || 844 }, deviceScaleFactor: 1,
      hasTouch: !opts.pc, isMobile: !opts.pc, userAgent: opts.iphone ? IPHONE : undefined, acceptDownloads: true,
    });
    open.push(ctx);
    const errors = [], asked = [];
    if (opts.init) await ctx.addInitScript(opts.init);
    if (opts.standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); }); // how an iPhone marks a page opened from the Home Screen
    if (opts.seed) await ctx.addInitScript(([key, json]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, json); }, [KEY, JSON.stringify(opts.seed)]);
    const tab = async () => {
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
      page.on('request', r => asked.push(r.url()));
      await page.goto(URL0);
      return page;
    };
    return { ctx, page: await tab(), tab, errors, asked };
  }
  async function done() { for (const c of open.splice(0)) await c.close(); site.setRoot(SITE); site.setDown(false); }
  const controlled = page => page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const version = page => page.evaluate(() => window.AppShell && window.AppShell.version);
  const becomes = (page, v) => page.waitForFunction(v => !!window.AppShell && window.AppShell.version === v && !!document.querySelector('.hud, #t-name'), v, { timeout: 15000 });
  const stateOf = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
  const metaOf = page => page.evaluate(k => JSON.parse(localStorage.getItem(k + '.meta')), KEY);
  const text = async (page, sel) => { await page.waitForFunction(() => !document.querySelector('[data-rolling]'), null, { timeout: 3000 }); return page.locator(sel).first().innerText(); };
  // A tab slides its screen in. The new screen is there, and takes taps, once the slide is over.
  const tabTo = async (page, t) => {
    await page.click('.tab[data-tab="' + t + '"]');
    await page.waitForFunction(t => document.querySelector('#app').dataset.tab === t && !document.documentElement.classList.contains('vt'), t);
  };
  async function begin(page, name) {
    await page.waitForSelector('#t-name');
    await page.fill('#t-name', name || 'Kai');
    await page.fill('#t-pushups', '18'); await page.fill('#t-situps', '25'); await page.fill('#t-squats', '30'); await page.fill('#t-run12', '1.8');
    await page.click('#layer [data-act="begin"]');
    await page.waitForSelector('.hud');
  }
  const system = async page => { await tabTo(page, 'system'); await page.waitForSelector('#app [data-act="backup-save"]'); };
  async function addReps(page, n) {
    await tabTo(page, 'quest');
    await page.fill('#in-pushups', String(n));
    await page.click('#app [data-act="add-custom"][data-id="pushups"]');
  }
  async function saveBackup(page) {
    await system(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#app [data-act="backup-save"]')]);
    const file = path.join(tmp, 'backup-' + Date.now() + '-' + dl.suggestedFilename());
    await dl.saveAs(file);
    return { name: dl.suggestedFilename(), file, body: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  async function paste(page, body) {
    await page.waitForSelector('#bk-text');
    await page.fill('#bk-text', typeof body === 'string' ? body : JSON.stringify(body));
    await page.click('#layer [data-act="backup-read"]');
  }

  console.log('Installing');
  await test('the page carries what an iPhone and an Android phone need to install it', async () => {
    const { page, errors } = await start();
    await page.waitForSelector('#t-name');
    const head = await page.evaluate(() => {
      const meta = n => (document.querySelector('meta[name="' + n + '"]') || {}).content, link = r => (document.querySelector('link[rel="' + r + '"]') || {}).href;
      return { viewport: meta('viewport'), capable: meta('apple-mobile-web-app-capable'), bar: meta('apple-mobile-web-app-status-bar-style'), title: meta('apple-mobile-web-app-title'), theme: meta('theme-color'), robots: meta('robots'), manifest: link('manifest'), touch: link('apple-touch-icon') };
    });
    assert.match(head.viewport, /viewport-fit=cover/);
    assert.equal(head.capable, 'yes');
    assert.equal(head.bar, 'black-translucent');
    assert.equal(head.title, 'Ascend');
    assert.equal(head.robots, 'noindex');
    assert.ok(head.manifest.endsWith(BASE + 'manifest.webmanifest') && head.touch.endsWith(BASE + 'icons/apple-touch-icon.png'));
    const size = src => page.evaluate(async src => { const b = await createImageBitmap(await (await fetch(src)).blob()); return b.width + 'x' + b.height; }, src);
    assert.equal(await size(head.touch), '180x180');
    // An iPhone only shows a launch picture whose size is exactly its screen.
    const launch = await page.evaluate(() => Array.from(document.querySelectorAll('link[rel="apple-touch-startup-image"]'), l => ({ href: l.href, media: l.media })));
    assert.equal(launch.length, 13);
    for (const l of launch) {
      const [, w, h, r] = l.media.match(/device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)/);
      assert.equal(await size(l.href), w * r + 'x' + h * r, l.href);
    }
    assert.deepEqual(errors, []);
    await done();
  });
  await test('Chrome finds a valid manifest and nothing that stops an install', async () => {
    const { ctx, page } = await start();
    await controlled(page);
    const cdp = await ctx.newCDPSession(page);
    const man = await cdp.send('Page.getAppManifest');
    assert.deepEqual(man.errors, []);
    const m = JSON.parse(man.data), at = p => new URL(p, man.url).pathname;
    assert.equal(at(m.start_url), BASE);
    assert.equal(at(m.scope), BASE);
    assert.equal(m.display, 'standalone');
    for (const purpose of ['any', 'maskable']) for (const s of ['192x192', '512x512']) assert.ok(m.icons.some(i => i.purpose === purpose && i.sizes === s), purpose + ' icon ' + s);
    assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, []);
    await done();
  });
  await test("the browser's offer to install becomes a button, and an iPhone gets the Home Screen steps instead", async () => {
    const a = await start();
    await a.page.waitForSelector('#t-name');
    assert.equal(await a.page.locator('#ob-install .banner').count(), 0);
    await a.page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__asked = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    assert.match(await text(a.page, '#ob-install'), /install the app/i);
    await a.page.click('#ob-install [data-act="app-install"]');
    await a.page.waitForFunction(() => window.__asked === true);
    await a.page.waitForFunction(() => !document.querySelector('#ob-install .banner')); // asked once: the offer is gone
    await done();
    const b = await start({ iphone: true });
    await b.page.waitForSelector('#t-name');
    assert.match(await text(b.page, '#ob-install'), /Share, then Add to Home Screen[\s\S]*before you start/i);
    await begin(b.page);
    await system(b.page);
    assert.match(await text(b.page, '#app'), /Running in the browser[\s\S]*save a backup here and restore it there/i);
    await done();
  });
  await test('opened from the home screen it says so and no longer explains how to install', async () => {
    const { page } = await start({ iphone: true, standalone: true });
    await page.waitForSelector('#t-name');
    assert.equal(await page.evaluate(() => window.AppShell.standalone), true);
    assert.equal(await page.locator('#ob-install .banner').count(), 0);
    await begin(page);
    await system(page);
    const all = await text(page, '#app');
    assert.match(all, /Installed on this device/);
    assert.match(all, /saved in this app on this device only/i);
    assert.doesNotMatch(all, /Home Screen/);
    // An iPhone too old to share a file must not be sent to a download either: there the file would replace the app.
    if (await page.evaluate(() => typeof navigator.share) === 'undefined') {
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.click('#app [data-act="backup-save"]');
      await page.waitForSelector('#bk-out');
      assert.equal(downloads, 0);
    }
    await done();
  });

  console.log('Offline');
  await test('everything the page shows comes from the site itself', async () => {
    const { page, asked, errors } = await start();
    await controlled(page);
    await begin(page);
    for (const t of ['hunter', 'log', 'hall', 'system']) await tabTo(page, t);
    await page.evaluate(() => document.fonts.ready);
    const outside = asked.filter(u => !u.startsWith(URL0) && !/^(data|blob):/.test(u));
    assert.deepEqual(outside, []);
    assert.deepEqual(site.missing, []);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('the app opens and plays with no connection, pictures and fonts included', async () => {
    const { ctx, page, errors } = await start();
    await controlled(page);
    assert.equal(await page.evaluate(() => window.AppShell.offline), true);
    await ctx.setOffline(true);
    await page.reload();
    await begin(page, 'Offline');
    await addReps(page, 5);
    for (const t of ['hunter', 'log', 'hall', 'system', 'quest']) await tabTo(page, t);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => Array.from(document.images).every(i => i.complete));
    assert.deepEqual(await page.evaluate(() => Array.from(document.images).filter(i => !i.naturalWidth).map(i => i.src)), []);
    for (const f of ['700 16px "Chakra Petch"', '400 16px "IBM Plex Sans"', 'italic 800 16px "Saira"']) assert.equal(await page.evaluate(f => document.fonts.check(f), f), true, f);
    await page.reload(); // still offline: the progress is there and the app is too
    await page.waitForSelector('.hud');
    assert.equal((await stateOf(page)).days[(await stateOf(page)).lastDay].progress.pushups, 5);
    assert.match(await text(page, '.pname'), /Offline/);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('a file the device dropped from its copy is fetched again and put back', async () => {
    const { page } = await start();
    await controlled(page);
    const has = () => page.evaluate(async () => { for (const k of await caches.keys()) if (await (await caches.open(k)).match(new URL('assets/hero.webp', location.href).href)) return true; return false; });
    assert.equal(await has(), true);
    await page.evaluate(async () => { for (const k of await caches.keys()) await (await caches.open(k)).delete(new URL('assets/hero.webp', location.href).href); });
    assert.equal(await has(), false);
    await page.reload();
    await page.waitForSelector('#t-name');
    await page.waitForFunction(() => Array.from(document.images).every(i => i.complete && i.naturalWidth > 0));
    await assert.doesNotReject(page.waitForFunction(async () => { for (const k of await caches.keys()) if (await (await caches.open(k)).match(new URL('assets/hero.webp', location.href).href)) return true; return false; }));
    await done();
  });

  console.log('New versions');
  await test('a new version found while the app is in use waits for a tap, then keeps the progress', async () => {
    const { page, errors } = await start();
    await controlled(page);
    await begin(page);
    await addReps(page, 7);
    await system(page);
    await page.click('#app [data-act="app-check"]');
    await page.waitForSelector('.toast:has-text("latest version")');
    assert.equal(await page.locator('.testbar.upd').count(), 0);
    site.setRoot(deploy('b000000002'));
    await page.click('#app [data-act="app-check"]');
    await page.waitForSelector('.testbar.upd');
    assert.equal(await version(page), VERSION); // nothing changed under the player
    assert.match(await text(page, '#app'), /A new version is ready[\s\S]*Update now/i);
    assert.equal(await page.locator('#app [data-act="app-check"]').count(), 0);
    assert.equal(await page.locator('.tab[data-tab="quest"]').count(), 1);
    await page.click('.testbar.upd [data-act="app-update"]');
    await becomes(page, 'b000000002');
    const s = await stateOf(page);
    assert.equal(s.days[s.lastDay].progress.pushups, 7);
    assert.equal(await page.locator('.testbar.upd').count(), 0);
    assert.deepEqual(await page.evaluate(async () => (await caches.keys()).length), 1); // the old copy is gone
    assert.deepEqual(errors, []);
    await done();
  });
  await test('a new version found while the app is opening is switched to without a tap', async () => {
    const { page, tab, errors } = await start();
    await controlled(page);
    await begin(page);
    await page.close();
    site.setRoot(deploy('b000000003'));
    const again = await tab(); // opened again later: the old copy shows first, the new one takes over
    await becomes(again, 'b000000003');
    await again.waitForSelector('.hud');
    assert.match(await text(again, '.pname'), /Kai/);
    assert.equal(await again.locator('.testbar.upd').count(), 0);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('a half finished deploy is left alone until the page and the worker agree', async () => {
    const { ctx, page, errors } = await start();
    await controlled(page);
    await begin(page);
    await system(page);
    site.setRoot(deploy('b000000004', { stalePage: true }));
    await page.click('#app [data-act="app-check"]');
    await page.waitForSelector('.toast:has-text("latest version")');
    assert.equal(await page.evaluate(() => window.AppShell.updateReady), false);
    await ctx.setOffline(true);
    await page.reload(); // the copy on the device is still whole
    await page.waitForSelector('.hud');
    assert.equal(await version(page), VERSION);
    await ctx.setOffline(false);
    site.setRoot(deploy('b000000004'));
    await system(page);
    await page.click('#app [data-act="app-check"]');
    await page.waitForSelector('.testbar.upd');
    await page.click('#app .screen [data-act="app-update"]'); // the row in System, not the bar at the top
    await becomes(page, 'b000000004');
    assert.deepEqual(errors, []);
    await done();
  });
  await test('a second open window is told when the version changes under it', async () => {
    const { page, tab } = await start();
    await controlled(page);
    await begin(page);
    const other = await tab();
    await other.waitForSelector('.hud');
    await controlled(other);
    await tabTo(other, 'log'); // in use, so it will not switch by itself
    site.setRoot(deploy('b000000005'));
    await system(page);
    await page.locator('#app [data-act="app-check"]').click({ timeout: 1500 }).catch(() => {}); // unless the app found the new version by itself on the way there
    await page.click('.testbar.upd [data-act="app-update"]');
    await becomes(page, 'b000000005');
    await other.waitForSelector('.testbar.upd');
    assert.equal(await version(other), VERSION);
    await other.click('.testbar.upd [data-act="app-update"]');
    await becomes(other, 'b000000005');
    await done();
  });
  await test('with no connection the check says so and changes nothing', async () => {
    const { page } = await start();
    await controlled(page);
    await begin(page);
    await system(page);
    site.setDown(true); // the browser's own offline switch does not reach the check for a new worker, so the host goes away instead
    await page.click('#app [data-act="app-check"]');
    await page.waitForSelector('.toast:has-text("No connection")');
    assert.equal(await page.locator('#app [data-act="app-check"]:not([disabled])').count(), 1);
    await done();
  });

  console.log('Backup');
  // The backup most of these tests restore: Kai, level 1, with 6 push-ups logged today. Made once, by the app itself.
  let saved = null;
  async function aBackup() {
    if (saved) return saved;
    const { ctx, page } = await start();
    await begin(page);
    await addReps(page, 6);
    saved = await saveBackup(page);
    open.splice(open.indexOf(ctx), 1);
    await ctx.close();
    return saved;
  }
  await test('a backup is one file with the whole progress in it', async () => {
    const { page, errors } = await start();
    await begin(page);
    await addReps(page, 6);
    await system(page);
    assert.match(await text(page, '#bk-line'), /No backup yet/);
    saved = await saveBackup(page);
    assert.match(saved.name, /^ascend-backup-\d{4}-\d\d-\d\d\.json$/);
    const b = saved.body, s = await stateOf(page);
    assert.equal(b.app, 'ascend-daily-quest');
    assert.equal(b.format, 1);
    assert.ok(Math.abs(Date.parse(b.exportedAt) - Date.now()) < 60000);
    assert.deepEqual([b.name, b.level, b.rank], ['Kai', 1, 'E']);
    assert.deepEqual(b.state, s);
    assert.match(await text(page, '#bk-line'), /Last backup: today/);
    assert.ok(Date.now() - (await metaOf(page)).backupAt < 60000);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('a backup file brings the progress back after a confirmation, and the replaced copy is kept', async () => {
    await aBackup();
    const { page, errors } = await start();
    await begin(page, 'Second');
    await addReps(page, 3);
    const before = await stateOf(page);
    await system(page);
    await page.click('#app [data-act="backup-open"]');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#layer [data-act="backup-pick"]')]);
    await chooser.setFiles(saved.file);
    await page.waitForSelector('#layer [data-act="backup-apply"]');
    const win = await text(page, '#layer');
    assert.match(win, /RESTORE\?/);
    assert.match(win, /Hunter\s+Kai/);
    assert.match(win, /E rank, level 1/);
    assert.match(win, /replaces the progress on this device: Second, level 1/);
    assert.equal((await stateOf(page)).name, 'Second'); // nothing happens before the answer
    await page.click('#layer [data-act="backup-apply"]');
    await page.waitForSelector('.toast:has-text("Backup restored")');
    const s = await stateOf(page);
    assert.equal(s.name, 'Kai');
    assert.equal(s.sid, saved.body.state.sid);
    assert.equal(s.days[s.lastDay].progress.pushups, 6);
    assert.ok(s.rev > Math.max(before.rev, saved.body.state.rev));
    assert.match(await text(page, '.pname'), /Kai/);
    assert.equal(await page.locator('#layer .overlay').count(), 0);
    // the copy that was replaced can be taken back
    await system(page);
    assert.match(await text(page, '#app'), /Earlier copy on this device[\s\S]*replaced by a backup/);
    await page.click('#app [data-act="stash-use"]');
    await page.click('#app [data-act="stash-use"]');
    await page.waitForSelector('.toast:has-text("earlier copy is back")');
    assert.equal((await stateOf(page)).name, 'Second');
    assert.equal((await stateOf(page)).days[(await stateOf(page)).lastDay].progress.pushups, 3);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('someone with a backup skips the Awakening Test on a new device', async () => {
    await aBackup();
    const { page, errors } = await start();
    await page.waitForSelector('#t-name');
    await page.click('#layer [data-act="backup-open"]');
    await page.waitForSelector('#bk-text');
    await page.keyboard.press('Escape'); // changing your mind leads back to the start
    await page.waitForSelector('#t-name');
    await page.click('#layer [data-act="backup-open"]');
    await paste(page, saved.body);
    await page.waitForSelector('#layer [data-act="backup-apply"]');
    assert.match(await text(page, '#layer'), /continue exactly where this backup stopped/i);
    await page.click('#layer [data-act="backup-cancel"]');
    await page.waitForSelector('#t-name'); // and so does saying no
    assert.equal(await stateOf(page), null);
    await page.click('#layer [data-act="backup-open"]');
    await paste(page, JSON.stringify(saved.body.state)); // the bare progress, without the wrapper, is read too
    await page.click('#layer [data-act="backup-apply"]');
    await page.waitForSelector('.hud');
    assert.match(await text(page, '.pname'), /Kai/);
    assert.equal((await stateOf(page)).days[(await stateOf(page)).lastDay].progress.pushups, 6);
    assert.equal(await page.locator('.tabs').isVisible(), true);
    assert.equal(await page.evaluate(k => localStorage.getItem(k + '.stash'), KEY), null);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('what is not a backup is refused with a reason and nothing changes', async () => {
    await aBackup();
    const { page, errors } = await start();
    await begin(page, 'Keeper');
    await system(page);
    await page.click('#app [data-act="backup-open"]');
    const broken = JSON.parse(JSON.stringify(saved.body)); delete broken.state.days[broken.state.lastDay].targets;
    const deep = JSON.parse(JSON.stringify(saved.body)); deep.state.testDay = 'soon'; // passes the first look and breaks a screen
    const future = JSON.parse(JSON.stringify(saved.body)); future.format = 2;
    const newer = JSON.parse(JSON.stringify(saved.body)); newer.state.v = 99;
    const older = JSON.parse(JSON.stringify(saved.body)); older.state.v = 1;
    const cases = [['', /Paste the backup text first/], ['hello', /not a backup of this app/], ['{"a":1}', /not a backup of this app/], ['[1,2]', /not a backup of this app/], ['null', /not a backup/],
      [JSON.stringify(broken), /damaged/], [JSON.stringify(deep), /damaged/], [JSON.stringify(newer), /newer version of the app/], [JSON.stringify(future), /newer version of the app/], [JSON.stringify(older), /earlier version of the game/], [JSON.stringify(saved.body).slice(0, -40), /not a backup/]];
    for (const [body, why] of cases) {
      await page.fill('#bk-text', body);
      await page.click('#layer [data-act="backup-read"]');
      assert.match(await text(page, '#bk-err'), why, body.slice(0, 30));
      assert.equal(await page.locator('#layer [data-act="backup-apply"]').count(), 0);
    }
    // the screens behind the window were not disturbed by trying those saves out (System holds the name in its field)
    assert.equal(await page.inputValue('#app #in-name'), 'Keeper');
    // a file that is far too large is not even read
    const big = path.join(tmp, 'big.json');
    fs.writeFileSync(big, Buffer.alloc(4100000, 0x20));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#layer [data-act="backup-pick"]')]);
    await chooser.setFiles(big);
    await page.waitForFunction(() => /too large/.test((document.querySelector('#bk-err') || {}).textContent || ''));
    await page.click('#layer [data-act="backup-cancel"]');
    assert.equal((await stateOf(page)).name, 'Keeper');
    assert.equal(await page.evaluate(k => localStorage.getItem(k + '.stash'), KEY), null);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('the days since a backup was last played are scored when it is restored', async () => {
    await aBackup();
    const old = JSON.parse(JSON.stringify(saved.body));
    const shift = (k, n) => { const [y, m, d] = k.split('-').map(Number), t = new Date(y, m - 1, d + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
    const s = old.state, last = s.lastDay, to = shift(last, -3);
    s.days = { [to]: s.days[last] }; s.lastDay = to;
    for (const k of ['created', 'graceDay', 'testDay', 'adjustDay']) s[k] = shift(s[k], -3);
    old.exportedAt = new Date(Date.now() - 3 * 86400000).toISOString();
    const { page, errors } = await start();
    await page.waitForSelector('#t-name');
    await page.click('#layer [data-act="backup-open"]');
    await paste(page, old);
    await page.waitForSelector('#layer [data-act="backup-apply"]');
    assert.match(await text(page, '#layer'), /3 days passed since this backup was last played/);
    await page.click('#layer [data-act="backup-apply"]');
    await page.waitForSelector('#layer .big-word');
    assert.match(await text(page, '#layer'), /3 days passed/); // the day report
    const now = await stateOf(page);
    assert.notEqual(now.lastDay, to);
    assert.equal(Object.keys(now.days).length, 4);
    assert.deepEqual(errors, []);
    await done();
  });
  await test('on an iPhone the backup goes out through the share sheet, and closing the sheet counts for nothing', async () => {
    const { page, errors } = await start({ iphone: true, init: () => {
      window.__shared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: d => !!(d && d.files && d.files.length) && !(window.__noJson && d.files[0].type === 'application/json') });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async d => {
        if (window.__shareFail) { const e = new Error('share'); e.name = window.__shareFail; throw e; }
        const f = d.files[0]; window.__shared.push({ name: f.name, type: f.type, text: await f.text() });
      } });
    } });
    await begin(page);
    await system(page);
    await page.evaluate(() => { window.__shareFail = 'AbortError'; });
    await page.click('#app [data-act="backup-save"]');
    await page.waitForTimeout(150);
    assert.match(await text(page, '#bk-line'), /No backup yet/);
    assert.equal(await page.locator('#layer .overlay').count(), 0);
    await page.evaluate(() => { window.__shareFail = ''; });
    await page.click('#app [data-act="backup-save"]');
    await page.waitForSelector('.toast:has-text("Backup handed over")');
    let out = await page.evaluate(() => window.__shared);
    assert.equal(out.length, 1);
    assert.match(out[0].name, /^ascend-backup-.*\.json$/);
    assert.equal(out[0].type, 'application/json');
    assert.deepEqual(JSON.parse(out[0].text).state, await stateOf(page));
    assert.match(await text(page, '#bk-line'), /Last backup: today/);
    // a phone that will not share that kind of file gets the same backup as plain text
    await page.evaluate(() => { window.__noJson = true; });
    await page.click('#app [data-act="backup-save"]');
    await page.waitForFunction(() => window.__shared.length === 2);
    out = await page.evaluate(() => window.__shared);
    assert.match(out[1].name, /^ascend-backup-.*\.txt$/);
    assert.equal(out[1].type, 'text/plain');
    // and when sharing is refused outright, the backup is shown as text to copy
    await page.evaluate(() => { window.__shareFail = 'NotAllowedError'; });
    await page.click('#app [data-act="backup-save"]');
    await page.waitForSelector('#bk-out');
    assert.deepEqual(JSON.parse(await page.inputValue('#bk-out')).state, await stateOf(page));
    await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied = t; } } }); });
    await page.click('#layer [data-act="backup-copy"]');
    await page.waitForSelector('.toast:has-text("Copied")');
    assert.equal(await page.evaluate(() => window.__copied), await page.inputValue('#bk-out'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#layer .overlay'));
    assert.deepEqual(errors, []);
    await done();
  });
  await test('a week in, the System tab asks for a backup until one is made', async () => {
    const { page } = await start();
    await begin(page);
    assert.equal(await page.locator('.tab[data-tab="system"].dot').count(), 0);
    await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)), d = new Date(); d.setDate(d.getDate() - 9); s.created = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); localStorage.setItem(k, JSON.stringify(s)); }, KEY);
    await page.reload();
    await page.waitForSelector('.hud');
    assert.equal(await page.locator('.tab[data-tab="system"].dot').count(), 1);
    await system(page);
    assert.match(await text(page, '#bk-line'), /No backup yet\. This device holds the only copy/);
    await Promise.all([page.waitForEvent('download'), page.click('#app [data-act="backup-save"]')]);
    await page.waitForSelector('.toast:has-text("Backup saved")');
    await tabTo(page, 'quest');
    assert.equal(await page.locator('.tab[data-tab="system"].dot').count(), 0);
    // two weeks later it asks again
    await page.evaluate(k => { const m = JSON.parse(localStorage.getItem(k + '.meta')); m.backupAt -= 15 * 86400000; localStorage.setItem(k + '.meta', JSON.stringify(m)); }, KEY);
    await page.reload();
    await page.waitForSelector('.hud');
    assert.equal(await page.locator('.tab[data-tab="system"].dot').count(), 1);
    await system(page);
    assert.match(await text(page, '#bk-line'), /Last backup: 15 days ago/);
    await done();
  });
  await test('the test clock keeps backups out, in both directions', async () => {
    const { page } = await start();
    await begin(page);
    await system(page);
    await page.click('#app [data-act="skip"]');
    await page.waitForSelector('.testbar');
    for (let i = 0; i < 4 && await page.locator('#layer [data-act="close-modal"]').count(); i++) await page.click('#layer [data-act="close-modal"]');
    await system(page);
    await page.click('#app [data-act="backup-save"]');
    await page.waitForSelector('.toast:has-text("Go back to today first")');
    await page.click('#app [data-act="backup-open"]');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#bk-text').count(), 0);
    await done();
  });

  console.log('The look as an app');
  await test('the notch and the home bar get their room', async () => {
    const { ctx, page } = await start({ iphone: true, standalone: true });
    const cdp = await ctx.newCDPSession(page);
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } }); } catch (e) { await done(); return 'skip'; }
    await begin(page);
    const box = await page.evaluate(() => {
      const px = (sel, prop) => parseFloat(getComputedStyle(document.querySelector(sel))[prop]);
      return { top: px('#app', 'paddingTop'), bar: document.querySelector('#statusbar').getBoundingClientRect().height, hud: document.querySelector('.hud').getBoundingClientRect().top, tabs: px('.tabs', 'paddingBottom'), app: px('#app', 'paddingBottom') };
    });
    if (box.top === 12) { await done(); return 'skip'; } // this browser build takes the override but does not apply it
    assert.equal(box.top, 12 + 59);
    assert.equal(box.bar, 59);
    assert.ok(box.hud >= 59, 'the status strip starts under the clock');
    assert.equal(box.tabs, 40);
    assert.equal(box.app, 72 + 34 + 24);
    await system(page);
    await page.evaluate(() => { const v = document.querySelector('#view'); v.scrollTop = v.scrollHeight; });
    const last = await page.evaluate(() => ({ note: document.querySelector('#app .note.fine').getBoundingClientRect().bottom, tabs: document.querySelector('.tabs').getBoundingClientRect().top }));
    assert.ok(last.note <= last.tabs, 'the last line of a screen clears the tab bar');
    // scrolled down, the small header holds the level under the status strip
    await page.waitForFunction(() => document.documentElement.classList.contains('mini-on'));
    await page.waitForTimeout(500); // it slides down into place
    const mini = await page.evaluate(() => document.querySelector('#mini .mini-in').getBoundingClientRect().top);
    assert.ok(mini >= 59, 'the small header starts under the clock, at ' + mini);
    await done();
  });
  await test('the tab bar stays at the bottom while scrolling, and steps aside while typing', async () => {
    const { page, errors } = await start({ iphone: true, standalone: true });
    await begin(page);
    const bar = () => page.evaluate(() => ({ bottom: Math.round(document.querySelector('.tabs').getBoundingClientRect().bottom), screen: innerHeight, page: Math.round(scrollY), typing: document.documentElement.classList.contains('typing') }));
    for (const t of ['quest', 'system']) {
      await tabTo(page, t);
      await page.evaluate(() => { const v = document.querySelector('#view'); v.scrollTop = v.scrollHeight / 2; });
      await page.waitForTimeout(100);
      const b = await bar();
      assert.equal(b.bottom, b.screen, t + ': the tab bar sits on the bottom edge');
      assert.equal(b.page, 0, t + ': the page itself never scrolls, only the frame inside it');
    }
    await tabTo(page, 'quest');
    await page.locator('#in-pushups').tap();
    await page.waitForTimeout(450);
    let b = await bar();
    assert.equal(b.typing, true, 'a field in use marks the page as typing');
    assert.ok(b.bottom > b.screen, 'while typing the tab bar is out of the way');
    await page.keyboard.type('12');
    await page.locator('#app [data-act="add-custom"][data-id="pushups"]').tap();
    await page.waitForTimeout(600);
    b = await bar();
    assert.equal(b.typing, false, 'adding the reps puts the keyboard away');
    assert.equal(b.bottom, b.screen, 'and the tab bar is back on the bottom edge');
    const s = await stateOf(page);
    assert.equal(s.days[s.lastDay].progress.pushups, 12);
    assert.equal(await page.locator('#in-pushups').count(), 1, 'the field is the same one, not drawn again');
    assert.deepEqual(errors, []);
    await done();
  });
  await test('nothing scrolls sideways on a small phone, a large phone or a PC', async () => {
    for (const size of [{ width: 320, height: 568 }, { width: 430, height: 932 }, { width: 1280, height: 800, pc: true }]) {
      const { page, errors } = await start(size);
      const wide = async where => { const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(o[0] <= o[1], where + ' at ' + size.width + ': ' + o[0] + ' > ' + o[1]); };
      await page.waitForSelector('#t-name');
      await wide('onboarding');
      await begin(page);
      for (const t of ['quest', 'hunter', 'log', 'hall', 'system']) { await tabTo(page, t); await wide(t); }
      await page.click('#app [data-act="backup-open"]');
      await page.waitForSelector('#bk-text');
      await wide('restore window');
      if (size.pc) { // a column in the middle, not a stretched phone screen
        const col = await page.evaluate(() => { const r = document.querySelector('#app').getBoundingClientRect(), w = document.querySelector('#layer .win').getBoundingClientRect(); return { left: r.left, right: innerWidth - r.right, width: r.width, win: w.width }; });
        assert.ok(col.width <= 460 && Math.abs(col.left - col.right) <= 16, JSON.stringify(col));
        assert.ok(col.win <= 420);
      }
      assert.deepEqual(errors, []);
      await done();
    }
  });

  await browser.close();
  site.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
