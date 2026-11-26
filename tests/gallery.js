// Takes pictures of every screen and reward moment, for looking at the design. It checks nothing.
// Run: node build.js && node tests/gallery.js [scene ...] [--out dir] [--scale 2] [--width 400]
// Scenes: start, play, clear, level, hunter, log, hall, system, veteran, penalty, rank, tap, skins, elite.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const serve = require('./serve.js');
const E = require('../engine.js');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const OUT = path.resolve(flag('out', path.join(__dirname, 'shots', 'gallery')));
const SCALE = Number(flag('scale', 1)), WIDTH = Number(flag('width', 400));
const want = name => !args.length || args.includes(name);

// A save that has been played for `days` days with every quest cleared.
function played(name, test, days, edit) {
  const today = E.gameDay(new Date());
  const s = E.newPlayer(name, test, E.addDays(today, -days), 4711);
  for (let d = 0; d < days; d++) {
    if (E.trialInfo(s).canStart) E.startTrial(s);
    const day = E.today(s);
    for (const id of E.QUEST_IDS) E.addProgress(s, id, day.targets[id], {});
    E.ensureDay(s, E.addDays(s.lastDay, 1));
  }
  s.rev = 5; s.savedAt = Date.now();
  if (edit) edit(s);
  return { 'dailyquest.v2': JSON.stringify(s) };
}

(async () => {
  const site = await serve();
  const browser = await chromium.launch();
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];

  async function open(seed) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 860 }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => problems.push(String(e)));
    if (seed) await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); sessionStorage.setItem('seeded', '1'); } }, seed);
    await page.goto(site.url);
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  const shot = async (page, name, o) => {
    o = o || {};
    await page.waitForTimeout(o.wait != null ? o.wait : 2700); // entrance effects and toasts are over by then
    if (o.full) { // a tall viewport instead of a stitched page, so the tab bar and a scrolling window land where they belong
      const h = await page.evaluate(() => { const ov = document.querySelector('#layer .overlay'); return Math.max(document.documentElement.scrollHeight, ov ? ov.scrollHeight : 0); });
      await page.setViewportSize({ width: WIDTH, height: Math.max(860, h) });
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    if (o.full) await page.setViewportSize({ width: WIDTH, height: 860 });
    console.log('  ' + name);
  };
  const tabTo = (page, t) => page.click('.tab[data-tab="' + t + '"]');
  const pick = async (page, id) => { if (!(await page.locator('#app .quest.act[data-id="' + id + '"]').count())) await page.click('#app .quest[data-id="' + id + '"]'); };
  const log = async (page, id, n) => { await pick(page, id); await page.fill('#in-' + id, String(n)); await page.click('#app [data-act="add-custom"][data-id="' + id + '"]'); };
  const close = async page => {
    for (let i = 0; i < 8; i++) {
      const chest = page.locator('#layer .btn[data-act="chest-open"]'), b = page.locator('#layer [data-act="close-modal"]');
      if (await chest.count() && await chest.isVisible()) await chest.click();
      else if (await b.count()) await b.first().click();
      else return;
      await page.waitForTimeout(60);
    }
  };
  // closes the one window that is open, opening its chest first if it has one
  const closeOne = async page => {
    const chest = page.locator('#layer .btn[data-act="chest-open"]');
    if (await chest.count() && await chest.isVisible()) { await chest.click(); await page.waitForTimeout(60); }
    const b = page.locator('#layer [data-act="close-modal"]');
    if (await b.count()) await b.first().click();
  };
  async function begin(page, t) {
    await page.waitForSelector('#t-name');
    await page.fill('#t-name', t.name);
    for (const k of ['pushups', 'situps', 'squats', 'run12', 'runMax']) if (t[k] != null) await page.fill('#t-' + k, String(t[k]));
  }

  if (want('start') || want('play') || want('clear') || want('level') || want('tap')) {
    const p = await open();
    await begin(p, { name: 'Kai', pushups: 28, situps: 30, squats: 40, runMax: 5 });
    if (want('start')) await shot(p, '01-onboarding', { full: true });
    await p.click('#layer [data-act="begin"]');
    await p.waitForSelector('.quests');
    if (want('start')) await shot(p, '02-quest-start', { full: true });
    if (want('tap')) {
      await p.click('#app [data-act="tap"][data-id="pushups"]');
      for (let i = 0; i < 12; i++) await p.click('#layer [data-act="tap-hit"]');
      await shot(p, '03-tap-mode', { wait: 500 });
      await p.click('#layer [data-act="tap-done"]');
    }
    await log(p, 'pushups', 50);
    await log(p, 'situps', 31);
    if (want('play')) await shot(p, '04-quest-in-progress', { full: true });
    if (want('clear') || want('level')) {
      await log(p, 'situps', 19);
      await log(p, 'squats', 70);
      await p.waitForTimeout(200);
      // a level-up can cut in before the clear
      if ((await p.locator('#layer .big-word').first().innerText().catch(() => '')) === 'LEVEL UP') { if (want('level')) await shot(p, '05-level-up', { wait: 900 }); await close(p); }
      await pick(p, 'run'); await p.fill('#in-run', '5'); await p.fill('#in-runmin', '27'); await p.click('#app [data-act="add-custom"][data-id="run"]');
      for (let i = 0; i < 3; i++) {
        const word = await p.locator('#layer .big-word').first().innerText().catch(() => '');
        if (word === 'CLEARED') {
          await shot(p, '06-cleared-chest', { wait: 900 });
          await p.click('#layer .btn[data-act="chest-open"]');
          await shot(p, '07-cleared-loot', { wait: 350 });
          await shot(p, '07b-cleared-loot-settled', { wait: 1500, full: true });
          await p.click('#layer [data-act="felt"][data-id="right"]');
          await p.click('#layer [data-act="close-modal"]');
        } else if (word === 'LEVEL UP') { if (want('level')) await shot(p, '05-level-up', { wait: 900 }); await p.click('#layer [data-act="close-modal"]'); }
        else break;
        await p.waitForTimeout(150);
      }
      await shot(p, '08-quest-cleared', { full: true });
    }
    await p.context().close();
  }

  if (want('hunter') || want('log') || want('hall') || want('system')) {
    const p = await open(played('Kai', { pushups: 28, situps: 30, squats: 40, runMax: 5 }, 6, s => { s.essence = 420; }));
    await p.waitForSelector('.quests'); await close(p);
    if (want('hunter')) for (const s of ['card', 'titles', 'skills', 'shop']) { await tabTo(p, 'hunter'); await p.click('#app [data-act="sub"][data-id="' + s + '"]'); await shot(p, '10-hunter-' + s, { full: true, wait: 600 }); }
    for (const t of ['log', 'hall', 'system']) if (want(t)) { await tabTo(p, t); await shot(p, '11-' + t, { full: true, wait: 600 }); }
    await p.context().close();
  }

  if (want('veteran')) {
    const p = await open(played('Kai', { pushups: 45, situps: 50, squats: 60, runMax: 5 }, 40, s => { s.essence = 2000; s.title = 'iron'; s.skills = ['splitFocus', 'overdrive'].filter(k => E.SKILLS.find(x => x.id === k && s.level >= x.level)); }));
    await p.waitForSelector('.quests'); await close(p);
    await log(p, 'pushups', 60);
    await shot(p, '20-veteran-quest', { full: true });
    await tabTo(p, 'hunter'); await shot(p, '21-veteran-card', { full: true, wait: 600 });
    await p.click('#app [data-act="sub"][data-id="skills"]'); await shot(p, '22-veteran-skills', { full: true, wait: 400 });
    await tabTo(p, 'hall'); await shot(p, '23-veteran-hall', { full: true, wait: 400 });
    await tabTo(p, 'log'); await shot(p, '24-veteran-log', { full: true, wait: 400 });
    await p.context().close();
  }

  if (want('penalty')) {
    const p = await open(played('Kai', { pushups: 28, situps: 30, squats: 40, runMax: 5 }, 9, s => { delete s.graceDay; }));
    await p.waitForSelector('.quests'); await close(p);
    await tabTo(p, 'system'); await p.click('#app [data-act="skip"]');
    await p.waitForSelector('#layer .big-word'); await shot(p, '30-penalty-report', { wait: 900 });
    await close(p);
    await shot(p, '31-penalty-quest', { full: true, wait: 600 });
    await p.click('#app [data-act="plank-timer"]'); await p.click('#layer [data-act="pl-toggle"]');
    await shot(p, '32-plank-timer', { wait: 2200 });
    await p.click('#layer [data-act="pl-cancel"]');
    await tabTo(p, 'system'); await p.click('#app [data-act="skip"]');
    await p.waitForSelector('#layer .big-word'); await shot(p, '33-streak-broken', { wait: 900 });
    await p.context().close();
  }

  if (want('rank')) {
    const p = await open(played('Kai', { pushups: 28, situps: 30, squats: 40, runMax: 5 }, 12, s => { s.rank = 0; }));
    await p.waitForSelector('.quests'); await close(p);
    await p.locator('#app [data-act="trial"]').first().click();
    await shot(p, '40-trial-confirm', { wait: 900 });
    await p.click('#layer [data-act="trial-go"]');
    await shot(p, '41-trial-running', { full: true, wait: 600 });
    const s = await p.evaluate(() => JSON.parse(localStorage.getItem('dailyquest.v2')));
    const day = s.days[s.lastDay];
    for (const id of ['pushups', 'situps', 'squats', 'run']) {
      await log(p, id, Math.max(day.targets[id], day.trial.req[id]));
      for (let i = 0; i < 4; i++) {
        const word = await p.locator('#layer .big-word').first().innerText().catch(() => '');
        if (!word) break;
        if (word === 'RANK UP') { await shot(p, '42-rank-up-flash', { wait: 1050 }); await shot(p, '43-rank-up', { wait: 1400 }); }
        await closeOne(p);
        await p.waitForTimeout(150);
        if (word === 'RANK UP') break;
      }
    }
    await tabTo(p, 'hunter'); await shot(p, '44-card-d-rank', { full: true, wait: 600 });
    await p.context().close();
  }

  if (want('skins')) {
    for (const skin of ['crimson', 'violet', 'emerald', 'amber']) {
      const p = await open(played('Kai', { pushups: 28, situps: 30, squats: 40, runMax: 5 }, 16, s => { s.items = ['theme-' + skin]; s.theme = 'theme-' + skin; }));
      await p.waitForSelector('.quests'); await close(p);
      await log(p, 'pushups', 20);
      await shot(p, '50-skin-' + skin + '-quest', { full: true, wait: 600 });
      await tabTo(p, 'hunter'); await shot(p, '51-skin-' + skin + '-card', { wait: 600 });
      await p.context().close();
    }
  }

  if (want('elite')) {
    for (const [rank, name] of [[3, 'b'], [4, 'a'], [5, 's']]) {
      const p = await open(played('Kai', { pushups: 45, situps: 50, squats: 60, runMax: 5 }, 20, s => {
        s.rank = rank; s.level = E.RANKS[rank].level + 3; s.hard = rank === 4; s.title = 'awakened'; s.essence = 5210; s.streak = 120; s.best = 120;
        s.items = ['frame-circuit', 'frame-obsidian', 'frame-gilded']; s.frame = ['frame-circuit', 'frame-obsidian', 'frame-gilded'][rank - 3];
      }));
      await p.waitForSelector('.quests'); await close(p);
      await shot(p, '60-rank-' + name + '-quest', { wait: 600 });
      await tabTo(p, 'hunter'); await shot(p, '61-rank-' + name + '-card', { full: true, wait: 600 });
      await p.context().close();
    }
  }

  await browser.close();
  site.close();
  if (site.missing.length) console.log('pictures the page asked for and did not get: ' + Array.from(new Set(site.missing)).join(', '));
  if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
  console.log('saved in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
