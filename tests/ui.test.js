// Drives the built page in a phone-sized headless browser. Run: node build.js && node tests/ui.test.js
// Needs Playwright with Chromium. For pictures of the screens, run tests/gallery.js.
const path = require('path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const serve = require('./serve.js');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')); }
}

(async () => {
  const site = await serve(), URL = site.url;
  const browser = await chromium.launch();

  // ----- a fake cloud: one document store shared by every page that is wired to it -----
  const docs = new Map(), wired = new Set();
  async function wire(page, opts) {
    opts = opts || {};
    wired.add(page);
    page.on('close', () => wired.delete(page));
    await page.exposeFunction('__cloudSet', async (p, json) => {
      docs.set(p, json);
      for (const w of wired) w.evaluate(([p, json]) => window.__cloudDeliver && window.__cloudDeliver(p, json), [p, json]).catch(() => {});
    });
    await page.exposeFunction('__cloudGet', async p => (docs.has(p) ? docs.get(p) : null));
    await page.addInitScript(o => {
      const subs = {};
      const snap = json => ({ id: 'save', exists: json != null, data: () => (json == null ? undefined : JSON.parse(json)), metadata: { fromCache: false, hasPendingWrites: false } });
      window.__cloudDeliver = (p, json) => { for (const fn of subs[p] || []) fn(snap(json)); };
      window.__sets = 0;
      const db = { doc(p) {
        if (p.split('/').length % 2) throw new TypeError('odd path');
        return {
          path: p, id: p.split('/').pop(),
          async get() { return snap(await window.__cloudGet(p)); },
          async set(data) { if (window.__cloudFail) throw { code: window.__cloudFail, message: 'mock' }; window.__sets++; await window.__cloudSet(p, JSON.stringify(data)); },
          onSnapshot(next) { (subs[p] = subs[p] || []).push(next); window.__cloudGet(p).then(json => setTimeout(() => next(snap(json)), o.delay || 20)); return () => {}; },
        };
      } };
      const user = { id: async () => o.uid || 'u_test' };
      window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : null) };
    }, opts);
  }

  async function open(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: opts.width || 400, height: opts.height || 860 }, deviceScaleFactor: opts.scale || 1, hasTouch: true, isMobile: true, reducedMotion: opts.calm ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    if (opts.cloud) await wire(page, opts.cloud === true ? {} : opts.cloud);
    if (opts.seed) await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); sessionStorage.setItem('seeded', '1'); } }, opts.seed);
    await page.goto(URL);
    return { ctx, page, errors };
  }
  // A number that changed counts its way to the new value, so a reading waits until it has arrived.
  const settled = page => page.waitForFunction(() => !document.querySelector('[data-rolling]'), null, { timeout: 3000 });
  const text = async (page, sel) => { await settled(page); return page.locator(sel).first().innerText(); };
  // A tab slides its screen in. The new screen is there, and takes taps, once the slide is over.
  const tabTo = async (page, t) => {
    await page.click('.tab[data-tab="' + t + '"]');
    await page.waitForFunction(t => document.querySelector('#app').dataset.tab === t && !document.documentElement.classList.contains('vt'), t);
  };
  const stateOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('dailyquest.v2')));
  const noSideScroll = async (page, where) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(o.sw <= o.cw, where + ': page is wider than the screen (' + o.sw + ' > ' + o.cw + ')');
  };
  async function onboard(page, t) {
    await page.waitForSelector('#t-name');
    await page.fill('#t-name', t.name || 'Kai');
    for (const k of ['pushups', 'situps', 'squats', 'run12', 'runMax']) if (t[k] != null) await page.fill('#t-' + k, String(t[k]));
    if (t.knee) await page.check('#t-knee');
  }
  const act = (page, a, id) => page.click('#app [data-act="' + a + '"]' + (id ? '[data-id="' + id + '"]' : ''));
  const layerAct = (page, a) => page.click('#layer [data-act="' + a + '"]');
  // The quest list shows the buttons of one task at a time (the others are folded away). This opens a task's row
  // unless it is open already. A finished task stays open for a moment before the next one opens by itself, so the
  // tap is checked and made again if the two crossed.
  const openRow = page => page.locator('#app .quest.act:not(.pen)').evaluateAll(els => (els[0] ? els[0].dataset.id : null));
  const pick = async (page, id) => { for (let i = 0; i < 3 && (await openRow(page)) !== id; i++) await page.click('#app .quest[data-id="' + id + '"] .q-head'); };
  const usable = '#app .q-more:not([inert]) ';
  // Closes the window that is open. The CLEARED window keeps its Claim button in the chest, so that is opened first.
  const openChest = page => page.click('#layer .btn[data-act="chest-open"]');
  async function closeOne(page) {
    const chest = page.locator('#layer .btn[data-act="chest-open"]');
    if (await chest.count() && await chest.isVisible()) await chest.click();
    await page.locator('#layer [data-act="close-modal"]').first().click();
  }
  async function closeModals(page) {
    for (let i = 0; i < 8; i++) {
      if (!(await page.locator('#layer [data-act="close-modal"]').count())) return;
      await closeOne(page);
      await page.waitForTimeout(30);
    }
  }
  async function drain(page) {
    const words = [];
    for (let i = 0; i < 8; i++) {
      const w = page.locator('#layer .big-word');
      if (!(await w.count())) break;
      words.push(await w.first().innerText());
      await closeOne(page);
      await page.waitForTimeout(30);
    }
    return words;
  }
  // Logs every task up to a share of its target. A level-up screen can cut in at any point, so those are closed on the way;
  // the CLEARED screen is left open for the caller.
  async function logAll(page, frac, seen) {
    const s = await stateOf(page), day = s.days[s.lastDay];
    for (const id of ['pushups', 'situps', 'squats', 'run']) {
      const want = id === 'run' ? Math.round(day.targets[id] * (frac || 1) * 100) / 100 : Math.ceil(day.targets[id] * (frac || 1));
      const left = Math.round((want - day.progress[id]) * 100) / 100;
      if (left <= 0) continue;
      await pick(page, id);
      await page.fill('#in-' + id, String(left));
      await act(page, 'add-custom', id);
      for (let i = 0; i < 4; i++) {
        const w = page.locator('#layer .big-word');
        if (!(await w.count())) break;
        const word = await w.first().innerText();
        if (seen) seen.push(word);
        if (word === 'CLEARED') break;
        await layerAct(page, 'close-modal');
      }
    }
  }

  console.log('Onboarding and the quest screen');
  let A;
  await test('fresh start shows the Awakening Test with a live placement', async () => {
    A = await open();
    await onboard(A.page, { name: 'Kai', pushups: 28, situps: 30, squats: 40, runMax: 5 });
    assert.match(await text(A.page, '#t-preview'), /50 push-ups, 50 sit-ups, 70 squats and 5 km/);
    assert.match(await text(A.page, '#tp-pushups'), /^tier 4$/i);
    assert.match(await text(A.page, '#tp-runMax'), /^tier 6$/i);
    await noSideScroll(A.page, 'onboarding');
    await layerAct(A.page, 'begin');
    await A.page.waitForSelector('.quests');
    const s = await stateOf(A.page);
    assert.deepEqual(s.targets, { pushups: 50, situps: 50, squats: 70, run: 5 });
    assert.equal(s.rev, 1);
    assert.equal(await A.page.locator('.quest').count(), 4);
    await noSideScroll(A.page, 'quest');
  });

  await test('the quest list opens one task at a time', async () => {
    const p = A.page;
    assert.equal(await openRow(p), 'pushups', 'the first unfinished task should be open');
    assert.equal(await p.locator(usable + '.q-btns').count(), 1);
    await p.click('#app .quest[data-id="squats"] .q-head');
    assert.equal(await openRow(p), 'squats');
    assert.equal(await p.locator(usable + '.q-btns').count(), 1);
    assert.equal(await p.locator(usable + '[data-act="add"][data-id="pushups"]').count(), 0);
    await p.click('#app .quest[data-id="squats"] .q-head'); // a tap on the open row folds it
    assert.equal(await openRow(p), null);
    await pick(p, 'pushups');
    assert.equal(await openRow(p), 'pushups');
  });

  await test('logging: quick buttons, custom amount, tap mode, undo', async () => {
    const p = A.page;
    await act(p, 'add', 'pushups'); // the first +1 button
    await p.click('#app [data-act="add"][data-id="pushups"][data-n="10"]');
    await p.fill('#in-pushups', '9');
    await p.press('#in-pushups', 'Enter');
    let s = await stateOf(p);
    assert.equal(s.days[s.lastDay].progress.pushups, 20);
    await pick(p, 'situps');
    await act(p, 'tap', 'situps');
    for (let i = 0; i < 5; i++) await layerAct(p, 'tap-hit');
    assert.equal(await text(p, '#tap-num'), '5');
    await layerAct(p, 'tap-done');
    s = await stateOf(p);
    assert.equal(s.days[s.lastDay].progress.situps, 5);
    await act(p, 'undo');
    s = await stateOf(p);
    assert.equal(s.days[s.lastDay].progress.situps, 0);
    assert.equal(s.totals.situps, 0);
    assert.match(await text(p, '.chip'), /Streak 0/);
  });

  await test('a timed run sets the pace and clearing opens the reward screens', async () => {
    const p = A.page;
    await pick(p, 'run');
    await p.fill('#in-run', '5'); await p.fill('#in-runmin', '27');
    await act(p, 'add-custom', 'run');
    let s = await stateOf(p);
    assert.equal(s.pace.best, 324);
    assert.equal(await p.locator('#app .quest.done[data-id="run"] .stamp').count(), 1, 'a finished task is stamped');
    assert.equal(await openRow(p), 'run', 'a finished task stays open for a moment');
    await p.waitForFunction(() => (document.querySelector('#app .quest.act:not(.pen)') || {}).dataset.id === 'pushups', null, { timeout: 2500 }); // then the list moves on to the first task that is still open
    const seen = [], before = s.essence;
    await logAll(p, 1, seen);
    await p.waitForSelector('#layer .big-word');
    assert.equal(await text(p, '#layer .big-word'), 'CLEARED');
    assert.ok(seen.includes('LEVEL UP'), 'expected a level-up on the way, saw ' + seen.join(', '));
    // the reward stays in the chest until it is opened
    assert.equal(await p.locator('#chest-loot').isVisible(), false);
    assert.equal(await p.locator('#layer [data-act="close-modal"]').isVisible(), false);
    await openChest(p);
    assert.equal(await p.locator('#chest-loot').isVisible(), true);
    assert.equal(await p.locator('#chest-shut').isVisible(), false);
    s = await stateOf(p);
    assert.ok(s.essence > before);
    await p.waitForFunction(n => document.querySelector('#loot-n').textContent === String(n), s.essence - before); // the count runs up to what the chest held
    await p.click('#layer [data-act="felt"][data-id="right"]');
    assert.equal(await p.locator('#layer [data-act="felt"].on').count(), 1);
    await closeModals(p);
    assert.equal(await p.locator('#app .quest .stamp').count(), 4);
    s = await stateOf(p);
    const day = s.days[s.lastDay];
    assert.equal(day.cleared, true);
    assert.equal(day.felt, 'right');
    assert.ok(s.essence > 0 && s.level > 1);
    assert.match(await text(p, '.chip'), /Streak 1/);
  });

  await test('every screen fits a 400 px and a 360 px phone', async () => {
    const p = A.page;
    for (const w of [400, 360]) {
      await p.setViewportSize({ width: w, height: 800 });
      for (const t of ['quest', 'hunter', 'log', 'hall', 'system']) {
        await tabTo(p, t);
        await noSideScroll(p, t + ' at ' + w);
        if (t === 'hunter') for (const s of ['titles', 'skills', 'shop', 'card']) { await act(p, 'sub', s); await noSideScroll(p, 'hunter/' + s + ' at ' + w); }
      }
    }
    await p.setViewportSize({ width: 400, height: 860 });
  });

  await test('progress survives a reload', async () => {
    const before = await stateOf(A.page);
    await A.page.reload();
    await A.page.waitForSelector('.quests');
    const after = await stateOf(A.page);
    assert.equal(after.rev, before.rev);
    assert.equal(after.totalXp, before.totalXp);
    assert.equal(await text(A.page, '.pname'), 'Kai');
  });

  console.log('Days, penalties, hard mode');
  await test('the test clock: a missed day brings a Penalty Quest with a plank', async () => {
    const p = A.page;
    await tabTo(p, 'quest');
    await pick(p, 'squats'); // a row left open on the day before
    await tabTo(p, 'system');
    await act(p, 'skip');
    await p.waitForSelector('#layer .big-word');
    assert.equal(await text(p, '#layer .big-word'), 'NEW DAY'); // yesterday was cleared
    await closeModals(p);
    assert.match(await text(p, '.testbar'), /\+1 day/);
    assert.equal(await openRow(p), 'pushups', 'a new day starts at its first task');
    await p.click('#app .quest[data-id="situps"] .q-head');
    assert.equal(await openRow(p), 'situps', 'and the first tap on another task opens it');
    await tabTo(p, 'system');
    await act(p, 'skip'); // nothing logged on the skipped day
    await p.waitForSelector('#layer .big-word');
    assert.equal(await text(p, '#layer .big-word'), 'PENALTY QUEST');
    await closeModals(p);
    assert.equal(await text(p, '.win-title'), 'PENALTY QUEST');
    assert.equal(await p.locator('.quest.pen').count(), 1);
    await act(p, 'plank-timer');
    await layerAct(p, 'pl-toggle');
    await p.waitForTimeout(1200);
    await layerAct(p, 'pl-done');
    let s = await stateOf(p);
    assert.ok(s.days[s.lastDay].penalty.done >= 1);
    assert.equal(s.days[s.lastDay].penalty.need, 240); // four minutes at overall tier 4
    for (let i = 0; i < 4; i++) await p.click('#app [data-act="plank-add"][data-n="60"]');
    await logAll(p);
    await closeModals(p);
    s = await stateOf(p);
    assert.equal(s.days[s.lastDay].cleared, true);
    assert.match(await text(p, '.chip'), /Streak 2/);
  });

  await test('Hard mode: on with a confirm, a failed penalty costs a level, off waits for the streak', async () => {
    const p = A.page;
    await tabTo(p, 'system');
    await act(p, 'hard-on');
    await layerAct(p, 'hard-go');
    let s = await stateOf(p);
    assert.equal(s.hard, true);
    assert.equal(await p.locator('.hud .tag-hard').count(), 1);
    await act(p, 'hard-off');
    s = await stateOf(p);
    assert.equal(s.hard, true); assert.equal(s.hardOffPending, true); // the streak is alive, so it only ends with it
    await act(p, 'hard-keep');
    const level = s.level;
    await act(p, 'skip'); await closeModals(p);            // penalty day cleared: streak 2
    await tabTo(p, 'system');
    await act(p, 'skip');                                  // a missed day
    assert.equal(await text(p, '#layer .big-word'), 'PENALTY QUEST');
    await closeModals(p);
    await tabTo(p, 'system');
    await act(p, 'skip');                                  // the penalty quest ignored
    await p.waitForSelector('#layer .big-word');
    assert.equal(await text(p, '#layer .big-word'), 'STREAK BROKEN');
    await closeModals(p);
    s = await stateOf(p);
    assert.equal(s.streak, 0);
    assert.equal(s.level, level - 1);
    assert.equal(s.xp, 0);
  });

  await test('going back to today throws the test days away', async () => {
    const p = A.page;
    await act(p, 'unskip');
    await closeModals(p);
    const s = await stateOf(p);
    assert.ok(!s.debugOffset);
    assert.equal(s.hard, false);
    assert.equal(s.clears, 0); // day one is still running, as before the skips
    assert.equal(s.days[s.lastDay].cleared, true);
    assert.equal(await p.locator('.testbar').count(), 0);
    assert.equal(await p.evaluate(() => localStorage.getItem('dailyquest.v2.pretest')), null);
    assert.deepEqual(A.errors, []);
  });

  console.log('Long play through a seeded save');
  await test('rank trial, skills, rest token, shop and Hunter Hall from a seeded save', async () => {
    const E = require(path.join(ROOT, 'engine.js'));
    // Build a save 40 days in: level and streak high enough for the D and C trials, a rest token and the Hall gate.
    const today = E.gameDay(new Date());
    const s = E.newPlayer('Seeded', { pushups: 45, situps: 50, squats: 60, runMax: 5 }, E.addDays(today, -40), 777);
    for (let d = 0; d < 40; d++) {
      const info = E.trialInfo(s);
      if (info.canStart && d !== 39) E.startTrial(s);
      const day = E.today(s);
      for (const id of E.QUEST_IDS) E.addProgress(s, id, day.targets[id], {});
      E.ensureDay(s, E.addDays(s.lastDay, 1));
    }
    assert.equal(s.lastDay, today);
    s.essence = 2000; s.items = []; s.theme = null; s.frame = null; s.rev = 5; s.savedAt = Date.now(); // chests may have dropped a cosmetic on the way
    const B = await open({ seed: { 'dailyquest.v2': JSON.stringify(s) } });
    const p = B.page;
    await p.waitForSelector('.quests');
    let st = await stateOf(p);
    assert.ok(st.rank >= 2, 'seed should hold C rank, has ' + st.rank);
    assert.ok(st.restTokens >= 1);
    assert.equal(st.hall.state, 'open');
    // rest token
    await act(p, 'rest'); await layerAct(p, 'rest-go');
    st = await stateOf(p);
    assert.equal(st.days[st.lastDay].kind, 'rest');
    assert.equal(await text(p, '.win-title'), 'REST DAY');
    await act(p, 'rest-cancel');
    st = await stateOf(p);
    assert.equal(st.days[st.lastDay].kind, 'quest');
    // skills
    await tabTo(p, 'hunter'); await act(p, 'sub', 'skills');
    await act(p, 'skill-on', 'splitFocus');
    await act(p, 'skill-on', 'earlyRiser');
    st = await stateOf(p);
    assert.deepEqual(st.skills, ['splitFocus', 'earlyRiser']);
    // shop: two taps to buy, then it is equipped
    await act(p, 'sub', 'shop');
    await act(p, 'buy', 'theme-violet');
    st = await stateOf(p); assert.equal(st.items.length, 0);
    await act(p, 'buy', 'theme-violet');
    st = await stateOf(p);
    assert.deepEqual(st.items, ['theme-violet']); assert.equal(st.theme, 'theme-violet'); assert.equal(st.essence, 1700);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.skin), 'violet');
    await act(p, 'sub', 'card');
    await p.click('#app [data-act="aura"][data-id="1"]');
    st = await stateOf(p); assert.equal(st.aura, 1);
    await tabTo(p, 'hall');
    await tabTo(p, 'log');
    // Split Focus on the quest screen, and the next trial
    await tabTo(p, 'quest');
    await pick(p, 'run');
    await act(p, 'focus', 'run');
    st = await stateOf(p); assert.equal(st.days[st.lastDay].focus, 'run');
    if (await p.locator('#app [data-act="trial"]').count()) {
      await p.locator('#app [data-act="trial"]').first().click();
      await layerAct(p, 'trial-go');
      st = await stateOf(p); assert.ok(st.days[st.lastDay].trial);
    }
    for (const t of ['quest', 'hunter', 'log', 'hall', 'system']) { await tabTo(p, t); await noSideScroll(p, 'seeded ' + t); }
    assert.deepEqual(B.errors, []);
    await B.ctx.close();
  });

  await test('a save from the first prototype is carried over', async () => {
    const E = require(path.join(ROOT, 'engine.js'));
    const today = E.gameDay(new Date()), y = E.addDays(today, -1);
    const old = { v: 1, name: 'OldHunter', created: E.addDays(today, -9), test: { pushups: 28, situps: 20, squats: 30, run: 5 }, level: 4, xp: 20, totalXp: 700,
      targets: { pushups: 20, situps: 16, squats: 22, run: 3 }, streak: 3, best: 5, clears: 6, fullClears: 0, totals: { pushups: 180, situps: 140, squats: 200, run: 21 },
      titles: ['awakened'], title: 'awakened', lastDay: y,
      days: { [y]: { targets: { pushups: 20, situps: 16, squats: 22, run: 3 }, progress: { pushups: 20, situps: 16, squats: 22, run: 3 }, done: {}, cleared: true, xp: 120, log: [] } } };
    const C = await open({ seed: { 'dailyquest.v1': JSON.stringify(old) } });
    const p = C.page;
    await p.waitForSelector('#t-name');
    assert.equal(await p.inputValue('#t-name'), 'OldHunter');
    assert.equal(await p.inputValue('#t-pushups'), '28');
    assert.match(await text(p, '#layer .win-sub'), /System update/);
    await p.fill('#t-situps', '30'); await p.fill('#t-squats', '40');
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    const s = await stateOf(p);
    assert.equal(s.name, 'OldHunter'); assert.equal(s.totalXp, 700); assert.equal(s.totals.run, 21); assert.equal(s.streak, 3);
    assert.ok(s.level > 1);
    assert.equal(s.days[y].result, 'clear');
    await p.reload(); await p.waitForSelector('.quests'); // not offered twice
    assert.deepEqual(C.errors, []);
    await C.ctx.close();
  });

  await test('Rank Trial: start, pass in the same day, rank up opens a skill slot and aura colours', async () => {
    const E = require(path.join(ROOT, 'engine.js'));
    const today = E.gameDay(new Date());
    const s = E.newPlayer('Trial', { pushups: 28, situps: 30, squats: 40, runMax: 5 }, E.addDays(today, -12), 99);
    for (let d = 0; d < 12; d++) { const day = E.today(s); for (const id of E.QUEST_IDS) E.addProgress(s, id, day.targets[id], {}); E.ensureDay(s, E.addDays(s.lastDay, 1)); }
    assert.ok(s.level >= 10 && s.rank === 0, 'seed should be level 10+ at E rank, is level ' + s.level);
    s.rev = 3; s.savedAt = Date.now();
    const T = await open({ seed: { 'dailyquest.v2': JSON.stringify(s) } });
    const p = T.page;
    await p.waitForSelector('.quests');
    await act(p, 'trial');
    assert.equal(await text(p, '#layer .big-word'), 'D RANK');
    await layerAct(p, 'trial-go');
    assert.match(await text(p, '.banner.gold'), /RANK TRIAL: D RANK/i);
    const seen = [];
    await logAll(p, 1, seen);
    seen.push(...await drain(p));
    assert.ok(seen.includes('RANK UP'), 'saw ' + seen.join(', '));
    let st = await stateOf(p);
    assert.equal(st.rank, 1);
    await tabTo(p, 'hunter');
    assert.ok(await p.locator('.swatch').count() >= 3); // auto, Ash, Verdant
    await act(p, 'sub', 'skills');
    await act(p, 'skill-on', 'secondWind');
    st = await stateOf(p);
    assert.deepEqual(st.skills, ['secondWind']);
    // undo takes the rank back with the set that earned it
    await tabTo(p, 'quest');
    await act(p, 'undo');
    st = await stateOf(p);
    assert.equal(st.rank, 0);
    assert.equal(st.days[st.lastDay].cleared, false);
    assert.deepEqual(T.errors, []);
    await T.ctx.close();
  });

  await test('injured or sick mode pauses the quest with no report and no penalty', async () => {
    const P = await open();
    const p = P.page;
    await onboard(p, { name: 'Rest', pushups: 8 });
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    await p.fill('#in-pushups', '7');
    await p.click('#app [data-act="add"][data-id="pushups"][data-n="5"]');
    assert.equal(await p.inputValue('#in-pushups'), '7', 'a typed amount should survive a redraw');
    await tabTo(p, 'system');
    await act(p, 'pause-on');
    await tabTo(p, 'quest');
    assert.equal(await text(p, '.win-title'), 'QUEST PAUSED');
    assert.equal(await p.locator('.quests').count(), 0);
    await tabTo(p, 'system');
    await act(p, 'skip');
    assert.equal(await p.locator('#layer .big-word').count(), 0, 'a paused day should not raise a report');
    let st = await stateOf(p);
    assert.equal(st.penaltyOwed, false);
    assert.equal(st.days[st.lastDay].paused, true);
    await act(p, 'pause-off');
    st = await stateOf(p);
    assert.equal(st.paused, false);
    assert.equal(await p.locator('.quests').count(), 1);
    assert.equal(st.days[st.lastDay].penalty, undefined);
    assert.deepEqual(P.errors, []);
    await P.ctx.close();
  });

  await test('re-test: a better result jumps the tier for today', async () => {
    const R = await open();
    const p = R.page;
    await onboard(p, { name: 'Again', pushups: 8, situps: 12, squats: 20, run12: 1.3 });
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    let st = await stateOf(p);
    assert.deepEqual(st.targets, { pushups: 20, situps: 20, squats: 30, run: 1.5 });
    await tabTo(p, 'system');
    await act(p, 'retest');
    assert.equal(await p.inputValue('#t-pushups'), '8');
    await p.fill('#t-pushups', '45');
    assert.match(await text(p, '#t-preview'), /100 push-ups/);
    await layerAct(p, 'retest-save');
    st = await stateOf(p);
    assert.equal(st.targets.pushups, 100);
    assert.equal(st.days[st.lastDay].targets.pushups, 100);
    assert.equal(st.targets.situps, 20);
    assert.match(await text(p, '.quest .q-count'), /\/ 100/);
    assert.deepEqual(R.errors, []);
    await R.ctx.close();
  });

  await test('a broken or foreign save is ignored instead of crashing the page', async () => {
    for (const bad of ['{not json', JSON.stringify({ v: 2, sid: 'x', name: 'Bad', level: '<img src=x onerror=alert(1)>' }), JSON.stringify({ v: 3, sid: 'x' })]) {
      const B = await open({ seed: { 'dailyquest.v2': bad } });
      await B.page.waitForSelector('#t-name');
      assert.deepEqual(B.errors, []);
      await B.ctx.close();
    }
  });

  await test('the day of the Awakening Test is never punished', async () => {
    const G = await open();
    const p = G.page;
    await onboard(p, { name: 'Late', pushups: 8 });
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    assert.match(await text(p, '#q-hint'), /You awakened today/);
    await tabTo(p, 'system');
    await act(p, 'skip'); // nothing logged on day one
    await p.waitForSelector('#layer .big-word');
    assert.equal(await text(p, '#layer .big-word'), 'NEW DAY');
    assert.match(await text(p, '#layer .note'), /never held against you/);
    await closeModals(p);
    assert.equal(await p.locator('.quest.pen').count(), 0);
    assert.match(await text(p, '#q-hint'), /A missed day means a Penalty Quest tomorrow/);
    await tabTo(p, 'log');
    await act(p, 'day', (await stateOf(p)).graceDay);
    assert.match(await text(p, '#app .rewards'), /Day of the Awakening Test\s+No penalty/);
    await tabTo(p, 'system');
    await act(p, 'skip'); // nothing logged on day two either
    await p.waitForSelector('#layer .big-word');
    assert.equal(await text(p, '#layer .big-word'), 'PENALTY QUEST');
    assert.deepEqual(G.errors, []);
    await G.ctx.close();
  });

  console.log('Cloud save, two devices');
  let D1, D2;
  const cloudDoc = () => { const raw = docs.get('data/users/u_test/save'); return raw ? JSON.parse(raw) : null; };
  const waitFor = async (fn, what, ms) => { const t0 = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t0 > (ms || 6000)) throw new Error('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 50)); } };
  await test('a new player is pushed to the cloud, one write per burst', async () => {
    D1 = await open({ cloud: true });
    const p = D1.page;
    await onboard(p, { name: 'Sync', pushups: 10, situps: 12, squats: 20, run12: 1.3 });
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    for (let i = 0; i < 6; i++) await p.click('#app [data-act="add"][data-id="pushups"][data-n="1"]');
    await waitFor(() => { const d = cloudDoc(); return d && JSON.parse(d.json).days[JSON.parse(d.json).lastDay].progress.pushups === 6; }, 'the push');
    const d = cloudDoc(), s = await stateOf(p);
    assert.equal(d.sid, s.sid); assert.equal(d.rev, s.rev); assert.equal(d.xp, s.totalXp);
    assert.ok(await p.evaluate(() => window.__sets) <= 3, 'too many writes');
    await tabTo(p, 'system');
    assert.match(await text(p, '#sync-line'), /Cloud save is on/);
  });

  await test('a second device with nothing saved picks the player up without onboarding', async () => {
    D2 = await open({ cloud: true });
    const p = D2.page;
    await p.waitForSelector('.quests');
    assert.equal(await text(p, '.pname'), 'Sync');
    const s = await stateOf(p);
    assert.equal(s.days[s.lastDay].progress.pushups, 6);
    assert.equal(await p.locator('#t-name').count(), 0);
  });

  await test('work on one device shows up on the other while it is open', async () => {
    const p2 = D2.page, p1 = D1.page;
    await pick(p2, 'squats');
    await p2.click('#app [data-act="add"][data-id="squats"][data-n="10"]');
    await waitFor(async () => { const s = await stateOf(p1); return s.days[s.lastDay].progress.squats === 10; }, 'device 1 to follow');
    await tabTo(p1, 'quest');
    assert.match(await text(p1, '.quest:nth-child(3) .q-count'), /^10/);
    const a = await stateOf(p1), b = await stateOf(p2);
    assert.equal(a.rev, b.rev);
    // and back again
    await pick(p1, 'situps');
    await p1.click('#app [data-act="add"][data-id="situps"][data-n="5"]');
    await waitFor(async () => { const s = await stateOf(p2); return s.days[s.lastDay].progress.situps === 5; }, 'device 2 to follow');
  });

  await test('a rep count in progress survives progress arriving from the other device', async () => {
    const p1 = D1.page, p2 = D2.page;
    await pick(p2, 'pushups');
    await p2.click('#app [data-act="tap"][data-id="pushups"]');
    for (let i = 0; i < 4; i++) await p2.click('#layer [data-act="tap-hit"]');
    await pick(p1, 'squats');
    await p1.click('#app [data-act="add"][data-id="squats"][data-n="1"]');
    await waitFor(async () => { const s = await stateOf(p2); return s.days[s.lastDay].progress.squats === 11; }, 'device 2 to load the work of device 1');
    assert.equal(await text(p2, '#tap-num'), '4', 'the count was lost when the cloud save came in');
    await layerAct(p2, 'tap-done');
    const s = await stateOf(p2);
    assert.equal(s.days[s.lastDay].progress.pushups, 10);
    assert.equal(s.days[s.lastDay].progress.squats, 11);
    await waitFor(async () => { const a = await stateOf(p1); return a.days[a.lastDay].progress.pushups === 10; }, 'device 1 to follow');
    assert.deepEqual(D1.errors, []); assert.deepEqual(D2.errors, []);
  });

  await test('the test clock stays out of the cloud and going back restores the real save', async () => {
    const p1 = D1.page;
    const before = cloudDoc(), real = (s => s.days[s.lastDay].progress.pushups)(await stateOf(p1));
    await tabTo(p1, 'system');
    await act(p1, 'skip'); await closeModals(p1);
    await pick(p1, 'pushups');
    await p1.click('#app [data-act="add"][data-id="pushups"][data-n="10"]');
    await p1.waitForTimeout(2500);
    assert.equal(cloudDoc().rev, before.rev, 'a test day reached the cloud');
    await tabTo(p1, 'system');
    assert.match(await text(p1, '#sync-line'), /test clock/);
    await act(p1, 'unskip'); await closeModals(p1);
    const s = await stateOf(p1);
    assert.equal(s.days[s.lastDay].progress.pushups, real);
    await waitFor(() => cloudDoc().rev === s.rev, 'the restored save to be pushed');
  });

  await test('a failed write is retried and does not lose the change', async () => {
    const p1 = D1.page;
    await p1.evaluate(() => { window.__cloudFail = 'unavailable'; });
    await tabTo(p1, 'quest');
    await pick(p1, 'pushups');
    await p1.click('#app [data-act="add"][data-id="pushups"][data-n="1"]');
    await p1.waitForTimeout(2300);
    await tabTo(p1, 'system');
    assert.match(await text(p1, '#sync-line'), /cannot be reached/);
    await p1.evaluate(() => { window.__cloudFail = null; });
    const s = await stateOf(p1);
    await waitFor(() => cloudDoc().rev === s.rev, 'the retry', 9000);
    assert.match(await text(p1, '#sync-line'), /Cloud save is on/);
  });

  await test('erasing on one device erases the other, and a new player takes over the cloud save', async () => {
    const p1 = D1.page, p2 = D2.page;
    await tabTo(p1, 'system');
    await act(p1, 'reset'); await act(p1, 'reset');
    await p1.waitForSelector('#t-name');
    await waitFor(() => cloudDoc().erased === true, 'the tombstone');
    await p2.waitForSelector('#t-name');
    assert.equal(await p2.evaluate(() => localStorage.getItem('dailyquest.v2')), null);
    await onboard(p2, { name: 'Second', pushups: 3 });
    await layerAct(p2, 'begin');
    await p2.waitForSelector('.quests');
    await waitFor(() => { const d = cloudDoc(); return d && !d.erased && JSON.parse(d.json).name === 'Second'; }, 'the new player');
    await p1.waitForSelector('.quests'); // device 1 was sitting on the onboarding screen
    assert.equal(await text(p1, '.pname'), 'Second');
    assert.deepEqual(D1.errors, []); assert.deepEqual(D2.errors, []);
  });

  await test('a stale device waits for the cloud before scoring a new day', async () => {
    // Device 3 last saw yesterday with nothing logged. The cloud holds yesterday cleared and today begun.
    const E = require(path.join(ROOT, 'engine.js'));
    const today = E.gameDay(new Date()), y = E.addDays(today, -1);
    const s = E.newPlayer('Stale', { pushups: 10 }, y, 4242);
    delete s.graceDay; // an ordinary day, not the day of the Awakening Test, so missing it costs a penalty
    s.rev = 1; s.savedAt = Date.now() - 86400000;
    const stale = JSON.stringify(s);
    for (const id of E.QUEST_IDS) E.addProgress(s, id, E.today(s).targets[id], {});
    E.ensureDay(s, today);
    s.rev = 9; s.savedAt = Date.now() - 1000;
    docs.set('data/users/u_stale/save', JSON.stringify({ v: 2, sid: s.sid, rev: 9, savedAt: s.savedAt, device: 'other', dead: [], xp: s.totalXp, json: JSON.stringify(s) }));
    const D3 = await open({ cloud: { uid: 'u_stale', delay: 400 }, seed: { 'dailyquest.v2': stale } });
    const p = D3.page;
    await p.waitForSelector('.quests');
    const got = await stateOf(p);
    assert.equal(got.rev, 9);
    assert.equal(got.streak, 1);
    assert.equal(got.penaltyOwed, false);
    assert.equal(await p.locator('#layer .big-word').count(), 0, 'no stale report should be on screen');
    assert.ok(await p.evaluate(() => !!localStorage.getItem('dailyquest.v2.stash')));
    // The copy that lost can be brought back by hand, and then it is the one the cloud keeps.
    await tabTo(p, 'system');
    assert.match(await text(p, '#app .opt'), /Earlier copy on this device/);
    await act(p, 'stash-use'); await act(p, 'stash-use');
    await drain(p);
    const back = await stateOf(p);
    assert.ok(back.rev > 9, 'the restored copy must outrank the cloud copy');
    assert.equal(back.penaltyOwed || !!back.days[back.lastDay].penalty, true); // yesterday really was missed on that copy
    await waitFor(() => JSON.parse(docs.get('data/users/u_stale/save')).rev === back.rev, 'the restored copy to reach the cloud');
    assert.equal(JSON.parse(await p.evaluate(() => JSON.parse(localStorage.getItem('dailyquest.v2.stash')).json)).rev, 9);
    assert.deepEqual(D3.errors, []);
    await D3.ctx.close();
  });

  await test('without a cloud the page starts at once and says where progress lives', async () => {
    const F = await open({ seed: {} });
    await onboard(F.page, { name: 'Local' });
    await layerAct(F.page, 'begin');
    await tabTo(F.page, 'system');
    assert.match(await text(F.page, '#sync-line'), /this browser on this device only/);
    assert.deepEqual(F.errors, []);
    await F.ctx.close();
  });

  await test('inside Claude a backup is text to copy, and a restored backup becomes the cloud save', async () => {
    const B = await open({ cloud: { uid: 'u_backup' } });
    const p = B.page, cloudRev = () => { const raw = docs.get('data/users/u_backup/save'); return raw ? JSON.parse(raw).rev : 0; };
    await onboard(p, { name: 'Boxed', pushups: 12 });
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    await tabTo(p, 'system');
    assert.equal(await p.evaluate(() => typeof window.AppShell), 'undefined'); // the page has no app shell here
    assert.doesNotMatch(await text(p, '#app'), /Check for updates|Home Screen/);
    assert.equal(await p.locator('.tab[data-tab="system"].dot').count(), 0);
    await act(p, 'backup-save'); // a download goes nowhere inside Claude, so the backup is shown
    await p.waitForSelector('#bk-out');
    const backup = await p.inputValue('#bk-out');
    assert.equal(JSON.parse(backup).state.name, 'Boxed');
    await layerAct(p, 'close-modal');
    await tabTo(p, 'quest');
    for (let i = 0; i < 4; i++) await p.click('#app [data-act="add"][data-id="pushups"][data-n="1"]');
    const played = await stateOf(p);
    await waitFor(() => cloudRev() === played.rev, 'the played copy to reach the cloud');
    await tabTo(p, 'system');
    await act(p, 'backup-open');
    await p.fill('#bk-text', backup);
    await layerAct(p, 'backup-read');
    await layerAct(p, 'backup-apply');
    await p.waitForSelector('.quests');
    const s = await stateOf(p);
    assert.equal(s.days[s.lastDay].progress.pushups, 0);
    assert.ok(s.rev > played.rev, 'the restored copy must outrank the cloud copy');
    await waitFor(() => cloudRev() === s.rev, 'the restored copy to reach the cloud');
    assert.equal(JSON.parse(JSON.parse(docs.get('data/users/u_backup/save')).json).days[s.lastDay].progress.pushups, 0);
    assert.deepEqual(B.errors, []);
    await B.ctx.close();
  });

  console.log('The look');
  await test('reward windows and toasts still work with reduced motion', async () => {
    const C = await open({ calm: true });
    const p = C.page;
    await onboard(p, { name: 'Calm', pushups: 8 });
    await layerAct(p, 'begin');
    await p.waitForSelector('.quests');
    await act(p, 'add', 'pushups');
    await p.waitForSelector('#toasts .toast');
    assert.equal(await p.locator('#toasts .toast').first().evaluate(el => getComputedStyle(el).opacity), '1', 'a toast should be readable while it is up');
    await logAll(p, 1);
    assert.equal(await text(p, '#layer .big-word'), 'CLEARED');
    await openChest(p);
    const s = await stateOf(p);
    assert.equal(await text(p, '#loot-n'), String(s.essence), 'the count should not run with reduced motion');
    assert.ok(await p.locator('#layer .rewards > div').first().evaluate(el => parseFloat(getComputedStyle(el).animationDuration) < 0.001), 'entrance effects should be cut short');
    await p.waitForFunction(() => getComputedStyle(document.querySelector('#layer .rewards > div')).opacity === '1', null, { timeout: 1500 }); // and they end shown, not hidden
    await closeModals(p);
    assert.equal(await p.locator('#layer .overlay').count(), 0);
    assert.deepEqual(C.errors, []);
    await C.ctx.close();
  });

  await test('every picture the screens ask for is there and loads', async () => {
    const E = require(path.join(ROOT, 'engine.js'));
    const today = E.gameDay(new Date());
    const s = E.newPlayer('Art', { pushups: 45, situps: 50, squats: 60, runMax: 5 }, E.addDays(today, -20), 31);
    for (let d = 0; d < 20; d++) { const day = E.today(s); for (const id of E.QUEST_IDS) E.addProgress(s, id, day.targets[id], {}); E.ensureDay(s, E.addDays(s.lastDay, 1)); }
    s.rank = 5; s.level = 90; s.rev = 4; s.savedAt = Date.now(); // S rank shows all six crests lit
    const P = await open({ seed: { 'dailyquest.v2': JSON.stringify(s) } });
    const p = P.page;
    await p.waitForSelector('.quests');
    await closeModals(p);
    const broken = [];
    const look = async where => {
      await p.waitForFunction(() => Array.from(document.images).every(i => i.complete));
      for (const src of await p.evaluate(() => Array.from(document.images).filter(i => !i.naturalWidth).map(i => i.getAttribute('src')))) broken.push(where + ': ' + src);
      const blank = await p.evaluate(() => Array.from(document.querySelectorAll('.ic')).filter(i => !(Number(i.style.getPropertyValue('--x')) >= 0)).length); // an icon name the sheet does not have
      if (blank) broken.push(where + ': ' + blank + ' icons without a picture');
    };
    for (const t of ['quest', 'hunter', 'log', 'hall', 'system']) {
      await tabTo(p, t);
      await look(t);
      if (t === 'hunter') for (const sub of ['titles', 'skills', 'shop', 'card']) { await act(p, 'sub', sub); await look('hunter/' + sub); }
    }
    assert.deepEqual(broken, []);
    // the icon sheet and the backdrop come in through the stylesheet
    const sheet = await p.evaluate(() => getComputedStyle(document.querySelector('.tab .ic')).maskImage || getComputedStyle(document.querySelector('.tab .ic')).webkitMaskImage);
    assert.match(sheet, /glyphs\.webp/);
    assert.deepEqual(P.errors, []);
    await P.ctx.close();
    assert.deepEqual(Array.from(new Set(site.missing)), [], 'pictures asked for in this run that are not in assets/');
  });

  await browser.close();
  site.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
