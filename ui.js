// ---------- UI layer (browser only). On iOS this part is rewritten; the Engine above is reused as it is. ----------
(() => {
  const E = Engine, T = E.TUNING;
  const KEY = 'dailyquest.v2', META = KEY + '.meta', PRETEST = KEY + '.pretest', STASH = KEY + '.stash', V1KEY = 'dailyquest.v1';
  const $ = s => document.querySelector(s);
  const app = $('#app'), layer = $('#layer'), toasts = $('#toasts'), tabs = $('#tabs'), mini = $('#mini'), ghost = $('#ghost'), root = document.documentElement;
  const view = $('#view') || document.scrollingElement || root; // the page scrolls in here; the document itself never does
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round(n * 100) / 100;
  const x1 = n => String(Math.round(n * 10) / 10);
  const fmt = (id, n) => id === 'run' ? String(r2(n)) : String(Math.round(n));
  const unit = id => id === 'run' ? ' km' : '';
  const pct = x => Math.round(x * 100) + '%';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const mmss = sec => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
  const quest4 = t => E.QUEST_IDS.map(id => fmt(id, t[id])).join(' / ') + ' km';
  const qname = id => E.QUESTS.find(q => q.id === id).name;
  const RESULT = { clear: 'Clear', near: 'Near clear', partial: 'Partial', weak: 'Weak effort', missed: 'Missed', rest: 'Rest day', paused: 'Paused' };
  const STAT = { STR: 'Strength', END: 'Endurance', AGI: 'Agility' };
  const FELT = { easy: 'Easy', right: 'Just right', hard: 'Too hard' };
  const dfmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const dateLabel = k => dfmt.format(E.parseKey(k));
  const timeLabel = ms => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  let state = null, meta = null, started = false, storageOk = true;
  let tab = 'quest', sub = 'card', logSel = null, armed = null, modal = null, queue = [];
  let pretestMem = null;
  const openDetails = {};
  // The installable web app wraps the page in a shell (pwa/pwa.js) that knows about versions and installing. Inside Claude there is none.
  const shell = window.AppShell || null;
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------- storage on this device ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { storageOk = false; return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    json(k) { const raw = this.get(k); if (!raw) return null; try { return JSON.parse(raw); } catch (e) { return null; } },
  };
  // A save may come from another device or an edited file, so its core is checked before it is used
  // and the small counters are filled in if they are missing.
  const CORE = ['level', 'xp', 'totalXp', 'rank', 'streak', 'best', 'clears', 'essence'];
  const SOFT = ['fullClears', 'hardClears', 'restTokens', 'clearRun', 'penaltyClears', 'penaltyCount', 'paceRuns'];
  const amount = v => Number.isFinite(v) && v >= 0;
  function valid(s) {
    if (!s || s.v !== E.VERSION || typeof s.sid !== 'string' || typeof s.name !== 'string' || typeof s.lastDay !== 'string') return false;
    if (!s.targets || !s.totals || !s.statBase || !s.pace || !s.test || !s.days || !CORE.every(k => amount(s[k]))) return false;
    if (!E.RANKS[s.rank] || s.level < 1 || s.level > E.MAX_LEVEL || (s.debugOffset != null && !amount(s.debugOffset))) return false;
    const day = s.days[s.lastDay];
    if (!day || !day.targets || !day.progress || !day.tiers) return false;
    if (!E.QUEST_IDS.every(id => amount(s.totals[id]) && s.targets[id] > 0 && day.targets[id] > 0 && amount(day.progress[id]) && E.TIERS[day.tiers[id] - 1])) return false;
    for (const k of SOFT) if (!amount(s[k])) s[k] = 0;
    for (const k of ['titles', 'items', 'skills', 'milestones']) if (!Array.isArray(s[k])) s[k] = [];
    if (!s.focus) s.focus = {};
    for (const id of E.QUEST_IDS) if (!amount(s.focus[id])) s.focus[id] = 0;
    if (!s.skillUse) s.skillUse = {};
    if (!s.hall || !['sealed', 'open', 'locked'].includes(s.hall.state)) s.hall = { state: 'sealed', idle: 0, clears: 0 };
    if (!E.TITLES.some(t => t.id === s.title)) s.title = s.titles.includes('awakened') ? 'awakened' : null;
    return true;
  }
  const now = () => new Date(Date.now() + ((state && state.debugOffset) || 0) * 86400000);
  const todayKey = () => E.gameDay(now());
  const testing = () => !!(state && state.debugOffset);
  function writeLocal() { if (state) store.set(KEY, JSON.stringify(state)); }
  function saveMeta() { store.set(META, JSON.stringify(meta)); }
  // Call after every real change: bumps the revision, keeps a local copy and queues the cloud save.
  function save() {
    state.rev = (state.rev || 0) + 1;
    state.savedAt = Date.now();
    writeLocal();
    cloudDirty();
  }
  function v1Save() {
    if (store.get(V1KEY + '.done')) return null;
    const o = store.json(V1KEY);
    return o && o.v === 1 && o.days ? o : null;
  }

  // ---------- cloud save ----------
  // One private document per person (data/users/<id>/save) through the page's db and user capabilities.
  // The copy in this browser is what the page plays from. The cloud copy makes it follow the person:
  // same player, the higher revision wins. A different player wins only if this one was erased, or it has more XP.
  const cloud = { api: !!(window.claude && typeof window.claude.use === 'function'), ref: null, status: 'none', ready: false, frozen: false, snap: undefined, pushing: false, dirty: false, timer: null, slow: null, first: 0, last: 0, tries: 0, subTries: 0 };
  let me = '';
  let settle = () => {};
  const settled = new Promise(res => { settle = res; });

  async function connectCloud() {
    cloud.status = 'connecting';
    setTimeout(() => { if (cloud.status === 'connecting') { cloud.status = 'unreachable'; syncUI(); } }, 12000);
    let db = null, user = null, uid = null;
    try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch (e) {}
    try { uid = db && user ? await user.id() : null; } catch (e) {}
    try { if (uid) cloud.ref = db.doc('data/users/' + uid + '/save'); } catch (e) { cloud.ref = null; }
    if (!cloud.ref) { cloud.status = 'none'; settle(); syncUI(); return; }
    try { subscribe(); } catch (e) { cloud.ref = null; cloud.status = 'none'; settle(); syncUI(); }
  }
  function subscribe() {
    clearTimeout(cloud.slow);
    cloud.slow = setTimeout(() => { if (!cloud.ready) { cloud.status = 'unreachable'; syncUI(); } }, 10000);
    cloud.ref.onSnapshot(snap => {
      const sure = !(snap.metadata && snap.metadata.fromCache);
      let body = null;
      try { if (snap.exists) body = snap.data() || null; } catch (e) {}
      cloud.snap = body;
      if (sure) { clearTimeout(cloud.slow); cloud.ready = true; cloud.subTries = 0; if (!cloud.frozen) cloud.status = 'on'; }
      reconcile();
      if (sure) settle();
      syncUI();
    }, err => {
      clearTimeout(cloud.slow);
      const code = err && err.code;
      cloud.ready = false;
      if (['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'invalid_argument', 'transform_error'].includes(code)) { cloud.status = 'none'; cloud.frozen = true; }
      else { // the listener died for a passing reason: listen again, further apart each time
        cloud.status = 'unreachable';
        if (++cloud.subTries <= 5) setTimeout(() => { try { subscribe(); } catch (e) {} }, Math.min(300000, 15000 * Math.pow(2, cloud.subTries - 1)));
      }
      settle(); syncUI();
    });
  }
  function cloudDirty(soon) {
    if (!cloud.ref || !cloud.ready || cloud.frozen || testing()) return;
    cloud.dirty = true;
    if (!cloud.first) cloud.first = Date.now();
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(push, soon || Date.now() - cloud.first > 6000 ? 0 : 1800); // one write per pause in the tapping
  }
  async function push() {
    if (cloud.pushing || !cloud.dirty || !cloud.ref || cloud.frozen || testing()) return;
    cloud.pushing = true; cloud.dirty = false; cloud.first = 0;
    const body = state
      ? { v: E.VERSION, sid: state.sid, rev: state.rev || 0, savedAt: state.savedAt || 0, device: me, dead: meta.dead, xp: state.totalXp, json: JSON.stringify(state) }
      : { v: E.VERSION, erased: true, dead: meta.dead, savedAt: Date.now(), device: me };
    try {
      // A write that never answers must not block every later one.
      await Promise.race([cloud.ref.set(body), new Promise((res, rej) => setTimeout(() => rej({ code: 'unavailable' }), 30000))]);
      cloud.status = 'on'; cloud.last = Date.now(); cloud.tries = 0;
    } catch (e) {
      const code = e && e.code;
      if (code === 'invalid_argument' || code === 'transform_error') { cloud.status = 'readonly'; cloud.frozen = true; }
      else if (code === 'quota_exceeded') { cloud.status = 'full'; cloud.frozen = true; }
      else if (['revoked', 'not_granted', 'capability_disabled', 'capability_removed'].includes(code)) { cloud.status = 'none'; cloud.frozen = true; }
      else { // a passing failure: keep the change queued and try again, further apart each time
        cloud.status = 'unreachable'; cloud.dirty = true;
        if (++cloud.tries <= 6) { clearTimeout(cloud.timer); cloud.timer = setTimeout(push, Math.min(120000, 4000 * Math.pow(2, cloud.tries - 1)) + Math.random() * 1500); }
      }
    }
    cloud.pushing = false;
    if (cloud.dirty && cloud.status === 'on') cloudDirty();
    syncUI();
  }
  // Compares the cloud copy with this device's copy and moves whichever is behind.
  function reconcile() {
    const r = cloud.snap;
    if (r === undefined || cloud.status === 'newer' || testing()) return; // the test clock is a sandbox: nothing goes in or out
    if (r && typeof r.v === 'number' && r.v > E.VERSION) { cloud.status = 'newer'; cloud.frozen = true; return; }
    if (r && Array.isArray(r.dead)) {
      const add = r.dead.filter(x => typeof x === 'string' && !meta.dead.includes(x));
      if (add.length) { meta.dead = meta.dead.concat(add).slice(-30); saveMeta(); }
    }
    if (!r) { if (state) cloudDirty(); return; }
    if (r.erased) {
      if (state && meta.dead.includes(state.sid)) wipeLocal('Progress was erased on another device.');
      else if (state) cloudDirty();
      return;
    }
    if (typeof r.json !== 'string' || typeof r.sid !== 'string') { if (state) cloudDirty(); return; }
    if (!state) { if (meta.dead.includes(r.sid)) cloudDirty(true); else adopt(r, 'cloud save'); return; }
    if (r.sid === state.sid) {
      const lr = state.rev || 0, rr = r.rev || 0, lt = state.savedAt || 0, rt = r.savedAt || 0;
      if (rr > lr || (rr === lr && rt > lt && r.device !== me)) adopt(r, 'newer save');
      else if (rr < lr || (rr === lr && lt > rt && r.device !== me)) cloudDirty();
      return;
    }
    if (meta.dead.includes(r.sid)) cloudDirty();
    else if (meta.dead.includes(state.sid)) adopt(r, 'erased elsewhere');
    else if (ahead(r.xp || 0, r.savedAt || 0, r.sid, state.totalXp, state.savedAt || 0, state.sid)) adopt(r, 'other save');
    else cloudDirty();
  }
  // Two different players and neither was erased: more XP wins, then the later save. The id settles a dead heat,
  // so two devices always agree on the winner instead of overwriting each other in turn.
  const ahead = (xp, at, sid, myXp, myAt, mySid) => xp !== myXp ? xp > myXp : at !== myAt ? at > myAt : sid > mySid;
  function adopt(r, why) {
    let s = null;
    try { s = JSON.parse(r.json); } catch (e) {}
    if (!valid(s)) { if (state) cloudDirty(); return; }
    if (state) store.set(STASH, JSON.stringify({ at: Date.now(), why, json: JSON.stringify(state) })); // the copy that lost stays recoverable
    delete s.debugOffset;
    state = s;
    writeLocal();
    if (!started) return;
    queue = [];
    if (modal !== 'tap' && modal !== 'plank') closeLayer(); // a count or a timer in progress stays open and is logged onto the loaded save
    const ev = E.ensureDay(state, todayKey());
    if (ev.length) save();
    render(); toast('Progress loaded from your cloud save.', 'ok'); handle(ev);
  }
  function wipeLocal(msg) {
    state = null; queue = []; pretestMem = null;
    store.del(KEY); store.del(PRETEST);
    if (!started) return;
    closeLayer(); render(); toast(msg, 'warn');
  }
  function stashInfo() {
    const s = store.json(STASH);
    if (!s || typeof s.json !== 'string' || Date.now() - (s.at || 0) > 30 * 86400000) return null;
    let st = null;
    try { st = JSON.parse(s.json); } catch (e) {}
    return valid(st) ? { at: s.at, why: s.why, state: st } : null;
  }
  function syncText() {
    if (testing()) return 'The test clock is running, so nothing is sent to your cloud save until you go back to today.';
    switch (cloud.status) {
      case 'on': return 'Cloud save is on. Your progress follows your Claude account to any device.' + (cloud.last ? ' Last saved at ' + timeLabel(cloud.last) + '.' : '');
      case 'connecting': return 'Connecting to your cloud save. Until then progress is kept in this browser.';
      case 'unreachable': return 'Your cloud save cannot be reached right now. Progress is kept in this browser and syncs when it answers.';
      case 'readonly': return 'Cloud save is not available with your access to this page. Progress is kept in this browser on this device only.';
      case 'full': return 'The cloud save is full, so new progress is kept in this browser on this device only.';
      case 'newer': return 'A newer version of this page has saved your progress. Reload the page to continue with it.';
      default: return !storageOk ? 'This browser is blocking storage, so progress will be lost when you close the page.'
        : 'Progress is saved in this ' + (shell && shell.standalone ? 'app' : 'browser') + ' on this device only.' + (shell ? ' A backup file is the only copy outside it.' : '');
    }
  }
  function syncUI() { const el = $('#sync-line'); if (el) el.textContent = syncText(); }

  // ---------- backup: the whole save as one file ----------
  // Outside Claude there is no cloud save, so the copy on this device is the only one. A backup is that copy as a
  // file the person keeps wherever they like, and it is also how progress moves to another phone or to a PC.
  // The file is plain JSON, { app, format, exportedAt, state }, where state is the engine's player state as it is,
  // so the iOS app can read the same file later.
  const BACKUP = { app: 'ascend-daily-quest', format: 1, firstDays: 7, everyDays: 14, maxBytes: 4000000 };
  let pending = null; // a backup that was read and waits to be confirmed
  const backupText = () => JSON.stringify({ app: BACKUP.app, format: BACKUP.format, exportedAt: new Date().toISOString(), name: state.name, level: state.level, rank: E.RANKS[state.rank].id, state });
  // Answers { state, at } for a usable backup, or { why } with what is wrong with it.
  function readBackup(text) {
    let o = null;
    try { o = JSON.parse(String(text || '').replace(/^\uFEFF/, '').trim()); } catch (e) {}
    if (!o || typeof o !== 'object') return { why: 'That is not a backup of this app.' };
    const s = o.app === BACKUP.app ? o.state : o; // the bare player state is accepted too
    const made = o.app === BACKUP.app ? Date.parse(o.exportedAt) : NaN;
    if ((o.app === BACKUP.app && o.format > BACKUP.format) || (s && typeof s.v === 'number' && s.v > E.VERSION)) return { why: 'This backup comes from a newer version of the app. Update the app first, then restore it.' };
    if (s && typeof s.v === 'number' && s.v < E.VERSION) return { why: 'This backup comes from an earlier version of the game and can no longer be read.' };
    if (!valid(s)) return { why: 'That is not a backup of this app, or the file is damaged.' };
    delete s.debugOffset;
    try { // a save can pass the check and still be broken deeper down, so a copy is played forward before it is trusted
      const probe = JSON.parse(JSON.stringify(s));
      E.ensureDay(probe, E.gameDay(new Date()));
      const d = E.today(probe);
      E.score(d); E.breakdown(probe, d); E.stats(probe); E.liveStreak(probe); E.trialInfo(probe); E.restInfo(probe); E.hallInfo(probe);
      if (!drawable(probe)) throw new Error('screens');
    } catch (e) { return { why: 'That backup is damaged and cannot be used.' }; }
    return { state: s, at: isFinite(made) ? made : s.savedAt || 0 };
  }
  // Draws every screen for a save without showing any of it. A save that would break a screen is found here,
  // before it replaces the one that works.
  function drawable(s) {
    const keep = [state, qsel, qselDay, Object.assign({}, shown)];
    try {
      state = s;
      questScreen(); cardView(); titlesView(); skillsView(); shopView(); logScreen(); hallScreen(); systemScreen();
      return true;
    } catch (e) { return false; }
    finally {
      [state, qsel, qselDay] = keep;
      for (const k of Object.keys(shown)) delete shown[k];
      Object.assign(shown, keep[3]);
    }
  }
  // A backup is worth a reminder a week after starting, and then every two weeks. Never while a cloud save is doing the job.
  function backupDue() {
    if (!state || testing() || (cloud.api && !['none', 'readonly', 'full'].includes(cloud.status))) return false;
    return meta.backupAt ? Date.now() - meta.backupAt > BACKUP.everyDays * 86400000 : E.daysBetween(state.created, state.lastDay) >= BACKUP.firstDays;
  }
  function backupLine() {
    if (!meta.backupAt) return 'No backup yet.';
    const d = Math.floor((Date.now() - meta.backupAt) / 86400000);
    return 'Last backup: ' + (d <= 0 ? 'today' : d === 1 ? 'yesterday' : plural(d, 'day') + ' ago') + '.';
  }
  const backedUp = () => { meta.backupAt = Date.now(); saveMeta(); };
  // Hands the backup over as a file. Answers 'shared', 'saved', 'cancelled' or 'failed'.
  async function saveFile(name, text) {
    if (IOS && navigator.share && navigator.canShare) { // an iPhone app on the home screen cannot download: the share sheet (Save to Files, AirDrop, Mail) is its way out
      for (const [type, as] of [['application/json', name], ['text/plain', name.replace(/\.json$/, '.txt')]]) {
        let file = null, can = false;
        try { file = new File([text], as, { type }); can = navigator.canShare({ files: [file] }); } catch (e) {}
        if (!can) continue;
        try { await navigator.share({ files: [file] }); return 'shared'; }
        catch (e) { return e && e.name === 'AbortError' ? 'cancelled' : 'failed'; }
      }
    }
    // Inside Claude the page is boxed in and a download goes nowhere. In an iPhone app on the home screen a download
    // would put the file in place of the app, with no way back. Both get the backup as text instead.
    if (cloud.api || (IOS && shell && shell.standalone)) return 'failed';
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return 'saved';
    } catch (e) { return 'failed'; }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    try { const box = $('#bk-out'); if (box) { box.focus(); box.select(); return document.execCommand('copy'); } } catch (e) {}
    return false;
  }

  // ---------- art ----------
  // Everything painted lives in assets/. Icons are one sprite of masks, tinted with the text colour.
  const A = 'assets/';
  const GLYPHS = ['pushups', 'situps', 'squats', 'run', 'str', 'end', 'agi', 'quest', 'hunter', 'log', 'hall', 'system', 'lock', 'clear', 'skull', 'trial', 'shield', 'rest', 'time', 'star'];
  const ic = (name, cls) => { const i = GLYPHS.indexOf(name); return `<i class="ic${cls ? ' ' + cls : ''}" style="--x:${i % 5};--y:${Math.floor(i / 5)}" aria-hidden="true"></i>`; };
  const ob = (name, cls) => `<img class="ob${cls ? ' ' + cls : ''}" src="${A}${name}.webp" alt="">`;
  const num = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  // The hunter with the aura behind him. The aura takes its colour from the nearest aura class and moves from A rank.
  const figure = live => `<span class="ka-fig"><i class="ka-aura${live ? ' live' : ''}"></i><img class="ka-hero" src="${A}hero.webp" alt=""></span>`;
  // The rank crest. `rank` is 0 (E) to 5 (S). The aura class colours the glow behind it.
  function crest(rank, aura, cls, live) {
    const id = E.RANKS[rank].id;
    return `<span class="crest r${rank} aura-${aura}${cls ? ' ' + cls : ''}${live ? ' live' : ''}" role="img" aria-label="Rank ${id}"><img src="${A}rank-${id.toLowerCase()}.webp" alt=""></span>`;
  }

  // ---------- motion ----------
  // The screen is described as HTML and then patched in place (morph): what stays on screen stays the same element.
  // A bar slides to its new width, a pressed button springs back, a field keeps its text, focus and keyboard.
  // Effects are asked for in the HTML (data-fx, data-roll) and played once, right after the patch.
  // Timing follows one small set of curves, the same ones ui.css names: things arrive fast and settle slowly,
  // things leave quickly, and only rewards overshoot.
  const calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const EASE = { out: 'cubic-bezier(.22, 1, .36, 1)', in: 'cubic-bezier(.55, 0, 1, .45)', inout: 'cubic-bezier(.65, 0, .35, 1)', spring: 'cubic-bezier(.34, 1.56, .64, 1)' };
  function play(el, frames, o) {
    if (!el || calm.matches || typeof el.animate !== 'function') return null;
    try { return el.animate(frames, Object.assign({ duration: 320, easing: EASE.out }, o)); } catch (e) { return null; }
  }
  // What each screen showed last, so a change can be told apart from a first look.
  const shown = {};
  const changed = (key, value) => { const was = shown[key]; shown[key] = value; return was != null && was !== value; };
  // A number that changed counts its way to the new value. `kind` picks the format. upOnly: going down just jumps.
  function roll(key, value, kind, upOnly) {
    const was = shown[key];
    shown[key] = value;
    return was != null && was !== value && (!upOnly || value > was) ? ` data-roll="${was}|${value}|${kind || ''}"` : '';
  }
  // A bar's fill is as wide as the bar and slides in from the left (--w is its share), so it moves without laying the page out again.
  const fill = (key, share) => `<i data-key="f-${key}" style="--w:${Math.round(Math.max(0, Math.min(1, share)) * 1000) / 1000}"></i>`;

  // morph: makes `root` look like `html` while keeping every element that can stay. Elements are matched by
  // data-key (or id) and otherwise by tag in order. Nodes marked data-float are passing decorations and are left alone.
  const tpl = document.createElement('template');
  const keyOf = n => n.nodeType === 1 ? n.getAttribute('data-key') || n.id || '' : '';
  const floating = n => n && n.nodeType === 1 && n.hasAttribute('data-float');
  const past = n => { while (floating(n)) n = n.nextSibling; return n; };
  function morph(root, html) { tpl.innerHTML = html; kids(root, tpl.content); }
  function kids(live, want) {
    let cur = past(live.firstChild);
    for (let nb = want.firstChild, next; nb; nb = next) {
      next = nb.nextSibling;
      const k = keyOf(nb);
      let m = null;
      if (k) { for (let c = cur; c; c = c.nextSibling) if (c.nodeName === nb.nodeName && keyOf(c) === k && !floating(c)) { m = c; break; } }
      else if (cur && cur.nodeName === nb.nodeName && !keyOf(cur)) m = cur;
      if (!m) { live.insertBefore(nb, cur); continue; } // a new node moves from the template into the page
      if (m === cur) cur = past(cur.nextSibling); else live.insertBefore(m, cur);
      patch(m, nb);
    }
    while (cur) { const n = cur.nextSibling; if (!floating(cur)) live.removeChild(cur); cur = n; }
  }
  function patch(a, b) {
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    const focused = a === document.activeElement;
    for (let i = a.attributes.length - 1; i >= 0; i--) { const n = a.attributes[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
    for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) {
      a.setAttribute(at.name, at.value);
      if (at.name === 'value' && a.tagName === 'INPUT' && !focused) a.value = at.value; // a saved value replaces what the field shows, unless someone is typing in it
    }
    if (a.tagName === 'INPUT' && (a.type === 'checkbox' || a.type === 'radio') && !focused) a.checked = b.hasAttribute('checked');
    if (a.tagName === 'TEXTAREA') return; // what was typed or pasted stays
    kids(a, b);
  }

  // Effects asked for by the HTML. Each plays once and the request is taken off the element.
  const FX = {
    bump: el => play(el, [{ transform: 'scale(1.32)', color: token('--g') }, { transform: 'none' }], { duration: 440, easing: EASE.spring }),
    stamp: el => play(el, [{ opacity: 0, transform: 'scale(2.4)' }, { opacity: 1, transform: 'scale(.86)', offset: .6 }, { opacity: 1, transform: 'none' }], { duration: 520 }),
    node: el => play(el.firstElementChild, [{ transform: 'scale(.4)' }, { transform: 'scale(1.55)', offset: .5 }, { transform: 'none' }], { duration: 620 }),
    lit: el => play(el, [{ transform: 'scale(.8)', filter: 'brightness(2)' }, { transform: 'scale(1.12)', offset: .45 }, { transform: 'none', filter: 'none' }], { duration: 700 }),
    enter: el => play(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360 }),
  };
  function runFx(root) {
    for (const el of root.querySelectorAll('[data-roll]')) {
      const [from, to, kind] = el.getAttribute('data-roll').split('|');
      el.removeAttribute('data-roll');
      rollTo(el, Number(from), Number(to), kind);
    }
    for (const el of root.querySelectorAll('[data-fx]')) {
      const list = el.getAttribute('data-fx').split(' ');
      el.removeAttribute('data-fx');
      for (const n of list) if (FX[n]) FX[n](el);
    }
  }
  const SHOW = { run: n => String(r2(n)), pct: n => Math.round(n) + '%', num: n => num(n) };
  function rollTo(el, from, to, kind) {
    if (calm.matches || !isFinite(from) || !isFinite(to)) return;
    const show = SHOW[kind] || (n => String(Math.round(n)));
    const end = el.textContent, ms = Math.min(720, 300 + Math.abs(to - from) * 14), mark = {};
    el._roll = mark;
    el.setAttribute('data-rolling', ''); // marks a number on its way, for anything that reads the screen
    const t0 = performance.now();
    const step = t => {
      if (el._roll !== mark) return;
      const k = el.isConnected ? Math.min(1, (t - t0) / ms) : 1;
      el.textContent = k >= 1 ? end : show(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step); else el.removeAttribute('data-rolling');
    };
    el.textContent = show(from);
    requestAnimationFrame(step);
  }
  function countUp(el, from, to, ms, show) {
    if (!el) return;
    show = show || (n => String(Math.round(n)));
    if (calm.matches || from === to) { el.textContent = show(to); return; }
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = show(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // A number that rises off a button: "+5" where the thumb was.
  function floatUp(from, text, cls) {
    if (calm.matches || !from) return;
    const r = from.getBoundingClientRect();
    if (!r.width) return;
    const el = document.createElement('div');
    el.className = 'floater' + (cls ? ' ' + cls : '');
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + r.height * .3) + 'px';
    document.body.appendChild(el);
    const a = play(el, [
      { opacity: 0, transform: 'translate(-50%, -30%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -95%) scale(1.12)', offset: .22 },
      { opacity: 1, transform: 'translate(-50%, -150%) scale(1)', offset: .55 },
      { opacity: 0, transform: 'translate(-50%, -230%) scale(.96)' },
    ], { duration: 820, easing: 'cubic-bezier(.2, .7, .3, 1)' });
    if (a) a.onfinish = () => el.remove(); else el.remove();
  }

  // Touch feedback. iPhones only show a pressed state once the page listens for touches, and they have no
  // vibration call: a hidden switch flipped by a tap makes the system tick instead (iOS 18 and later; elsewhere nothing happens).
  document.addEventListener('touchstart', () => {}, { passive: true });
  let tickEl = null;
  function tick1() {
    try {
      if (!tickEl) {
        tickEl = document.createElement('label');
        tickEl.setAttribute('aria-hidden', 'true');
        tickEl.style.display = 'none';
        const sw = document.createElement('input');
        sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.tabIndex = -1;
        tickEl.appendChild(sw);
      }
      document.head.appendChild(tickEl); tickEl.click(); tickEl.remove();
    } catch (e) {}
  }
  const HAPTIC = { tap: [10], ok: [14, 70, 22], big: [20, 80, 20, 80, 48], warn: [60, 90, 60] };
  function haptic(kind) {
    const p = HAPTIC[kind] || HAPTIC.tap;
    if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} return; }
    if (!IOS) return;
    for (let i = 0; i < Math.ceil(p.length / 2); i++) if (i) setTimeout(tick1, i * 95); else tick1();
  }

  // Sparks: one canvas above everything, drawn only while something is flying.
  const fxc = $('#fx'), fx2d = fxc && fxc.getContext ? fxc.getContext('2d') : null;
  let sparks = [], fxOn = false, fxLast = 0;
  const token = name => 'rgb(' + (getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(',') || '255,255,255') + ')';
  const tokenA = (name, a) => token(name).replace('rgb(', 'rgba(').replace(')', ',' + a + ')');
  function burst(x, y, o) {
    if (!fx2d || calm.matches) return;
    o = o || {};
    const cols = o.colors || [token('--g'), token('--v'), '#ffffff'];
    for (let i = 0, n = o.n || 26; i < n && sparks.length < 240; i++) {
      const a = (o.angle != null ? o.angle : -Math.PI / 2) + (Math.random() - 0.5) * (o.spread != null ? o.spread : Math.PI * 2);
      const v = (o.speed || 260) * (0.3 + Math.random() * 0.7);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.gravity != null ? o.gravity : 420, age: 0, ttl: (o.ttl || 0.9) * (0.6 + Math.random() * 0.6),
        s: (o.size || 5) * (0.5 + Math.random()), c: cols[i % cols.length], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10 });
    }
    if (fxOn) return;
    fxOn = true;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    fxc.width = Math.round(innerWidth * d); fxc.height = Math.round(innerHeight * d);
    fx2d.setTransform(d, 0, 0, d, 0, 0);
    fxLast = performance.now();
    requestAnimationFrame(fxFrame);
  }
  function fxFrame(t) {
    const dt = Math.min(0.05, (t - fxLast) / 1000);
    fxLast = t;
    fx2d.clearRect(0, 0, innerWidth, innerHeight);
    fx2d.globalCompositeOperation = 'lighter';
    sparks = sparks.filter(p => (p.age += dt) < p.ttl);
    for (const p of sparks) {
      const drag = 1 - 1.6 * dt, k = 1 - p.age / p.ttl, s = p.s * (0.4 + k * 0.6);
      p.vx *= drag; p.vy = p.vy * drag + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      fx2d.globalAlpha = Math.min(1, k * 1.6);
      fx2d.fillStyle = p.c;
      fx2d.save(); fx2d.translate(p.x, p.y); fx2d.rotate(p.r); fx2d.fillRect(-s / 2, -s / 2, s, s); fx2d.restore();
    }
    fx2d.globalAlpha = 1;
    if (sparks.length) requestAnimationFrame(fxFrame); else fxOn = false;
  }
  function burstAt(el, o) { if (!el) return; const r = el.getBoundingClientRect(); if (r.width) burst(r.left + r.width / 2, r.top + r.height / 2, o); }
  const goldSparks = () => [token('--goldc'), '#fff6d0', '#ffffff'];

  // ---------- toasts ----------
  function toast(text, cls, icon) {
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    if (icon) el.innerHTML = icon + '<span></span>';
    (icon ? el.lastChild : el).textContent = text;
    toasts.appendChild(el);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => el.remove(), 2500);
    return el;
  }
  // XP goes where XP lives: "+12 XP" beside the level bar that is in view (the full header, or the small one that
  // follows the page down), and quick taps add up in it. With neither in view it is a toast.
  let xpToast = null, gain = null;
  function xpGain(n) {
    const small = root.classList.contains('mini-on') && !root.classList.contains('typing'); // the small header may still be sliding in, so its place is not measured
    const bar = small ? mini && mini.querySelector('.bar.xp') : app.querySelector('.hud .bar.xp');
    const r = bar && bar.getBoundingClientRect();
    if (!bar || modal || (!small && (!r.width || r.bottom < 0 || r.top > innerHeight))) { xpToastAdd(n); return; }
    const home = bar.parentElement;
    if (gain && gain.el.isConnected && gain.home === home) clearTimeout(gain.t);
    else {
      if (gain) gain.el.remove();
      const el = document.createElement('span');
      el.className = 'xp-gain'; el.setAttribute('data-float', ''); el.setAttribute('aria-hidden', 'true');
      home.appendChild(el);
      gain = { el, home, sum: 0, t: 0 };
    }
    gain.sum += n;
    gain.el.textContent = '+' + gain.sum + ' XP';
    play(gain.el, [{ opacity: 0, transform: 'translateY(7px) scale(.7)' }, { opacity: 1, transform: 'translateY(-2px) scale(1.12)', offset: .45 }, { opacity: 1, transform: 'none' }], { duration: 420 });
    play(bar, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.9) saturate(1.2)', offset: .25 }, { filter: 'brightness(1)' }], { duration: 700 });
    const mine = gain;
    mine.t = setTimeout(() => {
      const end = () => { mine.el.remove(); if (gain === mine) gain = null; };
      const a = play(mine.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-9px)' }], { duration: 320, easing: EASE.in, fill: 'forwards' });
      if (a) a.onfinish = end; else end();
    }, 1500);
  }
  function xpToastAdd(n) {
    if (xpToast && xpToast.el.isConnected) {
      clearTimeout(xpToast.t);
      xpToast.sum += n;
      xpToast.el.textContent = '+' + xpToast.sum + ' XP';
      xpToast.el.style.animation = 'none'; void xpToast.el.offsetWidth; xpToast.el.style.animation = '';
    } else {
      const el = document.createElement('div');
      el.className = 'toast xp'; el.textContent = '+' + n + ' XP';
      toasts.appendChild(el);
      xpToast = { el, sum: n, t: 0 };
    }
    const mine = xpToast;
    mine.t = setTimeout(() => { mine.el.remove(); if (xpToast === mine) xpToast = null; }, 2500);
  }

  // ---------- events from the engine ----------
  // One thing at a time: while a reward window is on its way, the small messages wait and follow it once the last
  // window closes, instead of piling up on top of it. "Run complete" is left out when the CLEARED window says it.
  let later = [];
  function handle(events) {
    if (!events || !events.length) return;
    const levels = [];
    const big = events.some(e => e.type === 'clear' || e.type === 'level' || e.type === 'rank' || e.type === 'report');
    const cleared = events.some(e => e.type === 'clear');
    const say = (text, cls, icon) => { if (big || queue.length) later.push([text, cls, icon]); else toast(text, cls, icon); };
    for (const e of events) {
      if (e.type === 'xp') { if (e.amount > 0) xpGain(e.amount); }
      else if (e.type === 'task') {
        if (!cleared) say(e.name + ' complete', 'ok', ic('clear'));
        haptic('ok');
        const card = $('#app .quest[data-id="' + e.id + '"]');
        burstAt(card && card.querySelector('.q-med'), { colors: [token('--okc'), '#ffffff', token('--g')], n: 34, speed: 320 });
        play(card, [{ backgroundColor: tokenA('--okc', 0) }, { backgroundColor: tokenA('--okc', .3), offset: .22 }, { backgroundColor: tokenA('--okc', 0) }], { duration: 1100 });
      }
      else if (e.type === 'penaltyCleared') say('Penalty served. The streak carries on.', 'ok', ic('shield'));
      else if (e.type === 'stat') say(STAT[e.stat] + ' +' + e.gain + ' (now ' + e.value + ')', '', ic(e.stat.toLowerCase()));
      else if (e.type === 'title') say('Title unlocked: ' + e.name, 'gold', ic('star'));
      else if (e.type === 'level') levels.push(e);
      else if (e.type === 'clear' || e.type === 'rank' || e.type === 'report') queue.push(e);
    }
    if (levels.length) queue.push({ type: 'level', from: levels[0].level - 1, level: levels[levels.length - 1].level }); // several level-ups share one screen
    const order = { report: 0, clear: 1, level: 2, rank: 3 };
    queue.sort((a, b) => order[a.type] - order[b.type]);
    nextModal();
  }
  function nextModal() {
    while (!modal && state && queue.length) {
      const e = queue.shift();
      if (e.type === 'report') reportModal(e);
      else if (e.type === 'clear') clearModal(e);
      else if (e.type === 'level') levelModal(e);
      else if (e.type === 'rank') rankModal(e);
    }
    if (!modal && !queue.length && later.length) { // the last window is fading out: the held messages come in after it, one by one
      const held = later; later = [];
      held.forEach((m, i) => setTimeout(() => toast(m[0], m[1], m[2]), 260 + i * 200));
    }
  }
  // A system window over the page. `cls` may carry a colour mood: "gold" or "warnwin".
  // A window that closes fades out on a layer of its own, so the page, or the next window, is live at once.
  function retire() {
    const old = layer.firstElementChild;
    if (!old) return;
    if (calm.matches || !ghost || typeof old.animate !== 'function') { layer.innerHTML = ''; return; }
    for (const el of old.querySelectorAll('[id]')) el.removeAttribute('id');
    old.setAttribute('inert', ''); old.removeAttribute('role'); old.removeAttribute('aria-modal');
    ghost.appendChild(old);
    layer.innerHTML = '';
    const win = old.querySelector('.win, .tap-pad');
    play(old, [{ opacity: 1 }, { opacity: 0 }], { duration: 230, easing: EASE.in, fill: 'forwards' });
    if (win) play(win, [{ transform: 'none' }, { transform: 'translateY(12px) scale(.96)' }], { duration: 230, easing: EASE.in, fill: 'forwards' });
    setTimeout(() => old.remove(), 260);
  }
  function overlay(kind, inner, cls) {
    retire();
    modal = kind;
    cls = cls || '';
    const mood = /\bgold\b/.test(cls) ? ' gold' : /\bwarnwin\b/.test(cls) ? ' warnwin' : '';
    layer.innerHTML = `<div class="overlay k-${kind}${mood}" role="dialog" aria-modal="true"><div class="win ${cls}">${inner}</div></div>`;
    const f = layer.querySelector('[data-focus]');
    if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function closeLayer() { stopPlank(); modal = null; retire(); }
  const rewardRows = rows => rows.map(r => `<div${r[2] ? ' class="' + r[2] + '"' : ''}><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
  const sigil = name => `<div class="sigil">${ic(name)}</div>`;

  function penaltyText(p) {
    if (p.type === 'plank') return 'Plank, ' + mmss(p.need) + ' in total';
    return qname(p.id) + ' ' + fmt(p.id, p.need) + unit(p.id) + ' (+' + Math.round(p.pct) + '%)';
  }
  function xpRows(b, day) {
    const rows = [['Tasks', x1(b.tasks)]];
    if (b.overflow > 0) rows.push(['Extra work' + (day.overdrive ? ' (Overdrive)' : ''), '+' + x1(b.overflow)]);
    if (b.early > 0) rows.push(['Early Riser', '+' + x1(b.early)]);
    if (b.clear > 0) rows.push(['Clear bonus', '+' + b.clear]);
    if (b.streakPct > 0) rows.push(['Streak bonus +' + Math.round(b.streakPct * 100) + '%', '+' + x1(b.streak)]);
    if (b.hard > 0) rows.push(['Hard mode +' + Math.round(T.hardBonus * 100) + '%', '+' + x1(b.hard)]);
    rows.push(['XP today', b.total, 'sum']);
    return rows;
  }
  const feltButtons = day => `<div class="felt">${Object.keys(FELT).map(k => `<button class="btn ${day.felt === k ? 'on' : ''}" data-act="felt" data-id="${k}">${FELT[k]}</button>`).join('')}</div>`;

  // The day report: what the reset decided, and what today asks for.
  function reportModal(r) {
    const day = E.today(state), last = r.days[r.days.length - 1];
    if (r.days.every(d => d.result === 'paused') && !r.hall && !r.targets.length) return; // nothing happened while paused
    const rows = [];
    if (r.days.length > 1) {
      const count = {};
      for (const d of r.days) count[d.result] = (count[d.result] || 0) + 1;
      rows.push([plural(r.days.length, 'day') + ' passed', Object.keys(count).map(k => count[k] + ' ' + RESULT[k].toLowerCase()).join(', ')]);
    } else rows.push(['Yesterday', RESULT[last.result] + (last.result === 'rest' || last.result === 'paused' ? '' : ', ' + pct(last.score))]);
    rows.push(['Streak', r.streakFrom === r.streakTo ? String(r.streakTo) : r.streakFrom + ' &rarr; ' + r.streakTo]);
    if (r.broke && r.broke.hard) rows.push(['Hard mode', 'Lv ' + r.broke.hard.levelFrom + ' &rarr; ' + r.broke.hard.levelTo + ', ' + r.broke.hard.xp + ' XP wiped']);
    if (r.secondWind) rows.push(['Second Wind', 'Streak saved']);
    if (r.tokens) rows.push(['Rest token', '+' + r.tokens]);
    for (const m of r.milestones) rows.push([m.days + '-day streak', '+' + m.essence + ' Essence']);
    for (const t of r.targets) {
      rows.push(t.dir === 'held' ? ['Quest held', 'Felt too hard twice'] : [t.dir === 'up' ? 'Quest grows' : 'Quest lowered', 'about ' + (t.dir === 'up' ? '+' : '-') + Math.round(T.rampPct * 100) + '%']);
      for (const u of t.tierUps || []) rows.push([qname(u.id) + ' tier up', 'Tier ' + u.tier + ', XP x' + E.multOf(u.tier)]);
    }
    if (r.trialFailed) rows.push([r.trialFailed + '-rank trial', 'Not passed, retry in ' + plural(T.trialRetryDays, 'day')]);
    if (r.hall) rows.push(['Hunter Hall', r.hall === 'opened' ? 'Open' : r.hall === 'locked' ? 'Locked' : 'Open again']);
    if (r.hardOff) rows.push(['Hard mode', 'Off']);
    rows.push(["Today's quest", quest4(day.targets), 'sum']);
    if (r.penalty) rows.push(['Extra task', penaltyText(r.penalty)]);

    let word = 'NEW DAY', cls = '', btn = 'Begin', msg, mark = 'star';
    const res = last.result;
    if (r.broke) {
      word = 'STREAK BROKEN'; cls = 'warnwin'; btn = 'Get back up'; mark = 'skull';
      msg = 'A Penalty Quest went unfinished and your ' + r.broke.lost + '-day streak is gone.' + (r.broke.hard ? ' Hard mode took a level with it. Your rank stays.' : '') + (r.penalty ? ' Today is another Penalty Quest.' : ' Start the next streak today.');
    } else if (r.penalty) {
      word = 'PENALTY QUEST'; cls = 'warnwin'; btn = 'Accept'; mark = 'skull';
      msg = (r.missed ? 'A day went by with nothing logged.' : 'Yesterday barely counted.') + ' Clear the quest and the extra task today and the streak carries on. Fail and it resets to 0.' + (state.hard ? ' Hard mode doubles the extra task.' : '');
    } else if (r.secondWind) msg = 'Second Wind caught you: the Penalty Quest failed, but the streak survived. It will not catch you again for ' + T.secondWindDays + ' days.';
    else if (res === 'clear') msg = last.penalty === 'cleared' ? 'Penalty served. You are back on the road.' : 'Cleared. Now do it again.';
    else if (res === 'near') msg = 'Close enough to count. The streak grew, but there was no clear bonus and no chest.';
    else if (res === 'partial') msg = 'The streak held and nothing more. Reach 75% to make a day count.';
    else if (res === 'rest') msg = 'You rested and the streak held.';
    else if (res === 'paused') msg = 'You were paused. Nothing was lost.';
    else if (last.grace) msg = 'The day you awakened is never held against you. From today on, a day under 25% brings a Penalty Quest.';
    else msg = 'A new quest is ready.';

    overlay('report', `<div class="label">System report${testing() ? ' (test clock)' : ''}</div>
      ${sigil(mark)}
      <h2 class="big-word mid">${word}</h2>
      <div class="rewards">${rewardRows(rows)}</div>
      <p class="note">${msg}</p>
      <button class="btn primary wide" data-act="close-modal" data-focus>${btn}</button>`, 'center ' + cls);
    if (r.broke) haptic('warn');
  }

  // The clear screen: the chest waits to be opened, then the rewards are counted out.
  function clearModal(e) {
    const day = E.today(state), live = E.liveStreak(state);
    const item = e.chest.item ? E.ITEMS.find(x => x.id === e.chest.item) : null;
    const b = E.breakdown(state, day), rows = [];
    if (b.clear > 0) rows.push(['Clear bonus', '+' + b.clear + ' XP']);
    rows.push(['XP today', b.total, 'sum']);
    rows.push(day.penalty && !E.penaltyDone(day) ? ['Penalty extra task', 'Still open'] : ['Streak at the next reset', plural(live.n, 'day')]);
    overlay('clear', `<div class="label">${day.penalty ? 'Penalty quest' : 'Daily quest'}</div>
      <h2 class="big-word">CLEARED</h2>
      <button class="stage chest-stage" data-act="chest-open" aria-label="Open the chest"><i class="rays"></i><img class="chest shut" src="${A}chest-closed.webp" alt=""><img class="chest open" src="${A}chest-open.webp" alt=""><i class="flash"></i></button>
      <div class="stack wide" id="chest-shut">
        <p class="note">Your reward chest is waiting.</p>
        <button class="btn primary wide" data-act="chest-open" data-focus>Open the chest</button>
      </div>
      <div class="stack wide" id="chest-loot" hidden>
        <div class="loot">
          <div class="loot-item">${ob('essence')}<b>+<span id="loot-n" data-n="${e.chest.essence}">0</span></b><small>Essence</small></div>
          ${item ? `<div class="loot-item gold"><span class="sw ${item.id}"></span><b>${esc(item.name)}</b><small>${item.kind === 'theme' ? 'Rare drop: theme' : 'Rare drop: card frame'}</small></div>` : ''}
        </div>
        <div class="rewards">${rewardRows(rows)}</div>
        <div class="stack wide"><div class="label">How did it feel?</div>${feltButtons(day)}</div>
        <p class="note">${e.full ? 'That was the full routine: 100 / 100 / 100 / 5 km. This is the limit. Hold it.' : 'Your answer steers how fast the quest grows.'}</p>
        <button class="btn primary wide" data-act="close-modal">Claim</button>
      </div>`, 'center clearwin');
    haptic('big');
  }
  function openChest() {
    const w = layer.querySelector('.clearwin'), loot = $('#chest-loot');
    if (!w || !loot || w.classList.contains('opened')) return;
    w.classList.add('opened');
    $('#chest-shut').hidden = true;
    loot.hidden = false;
    toasts.textContent = ''; // the taller window reaches the top of the screen, and the loot gets the stage
    const n = $('#loot-n');
    countUp(n, 0, Number(n.dataset.n), 700);
    burstAt(w.querySelector('.chest-stage'), { colors: goldSparks().concat(token('--g'), token('--v')), n: 70, speed: 460, spread: Math.PI * 1.3, gravity: 620, ttl: 1.3, size: 6 });
    haptic('ok');
    const b = loot.querySelector('[data-act="close-modal"]');
    if (b) try { b.focus({ preventScroll: true }); } catch (err) {}
  }

  function levelModal(e) {
    const tri = E.trialInfo(state);
    const skills = E.SKILLS.filter(k => !k.inactive && k.level > e.from && k.level <= e.level).map(k => k.name);
    let note = '';
    if (e.level >= E.MAX_LEVEL) note = 'Level ' + E.MAX_LEVEL + '. There is nothing above this.';
    else if (tri.next && tri.levelOk) note = 'The <b>' + tri.next.id + '-rank</b> Rank Trial is open' + (tri.wait ? ' in ' + plural(tri.wait, 'day') : '') + ': ' + quest4(tri.next.trial) + ' in one day.';
    else if (tri.next) note = '<b>' + tri.next.id + ' rank</b> needs level ' + tri.next.level + ' and a Rank Trial.';
    overlay('level', `<div class="stage"><i class="rays"></i><div class="burst">${myCrest()}</div></div>
      <h2 class="big-word">LEVEL UP</h2>
      <div class="lv-jump"><span>Lv ${e.from}</span><i></i><b>Lv <span id="lv-to">${e.level}</span></b></div>
      ${skills.length ? `<div class="rewards">${rewardRows(skills.map(n => ['New skill', n]))}</div>` : ''}
      ${note ? `<p class="note">${note}</p>` : ''}
      <button class="btn primary wide" data-act="close-modal" data-focus>Continue</button>`, 'center');
    countUp($('#lv-to'), e.from, e.level, 600);
    burstAt(layer.querySelector('.burst'), { n: 46, speed: 380, gravity: -120, ttl: 1.2 });
    haptic('big');
  }

  // Rank up: the old crest gives way to the new one.
  function rankModal(e) {
    const idx = E.RANKS.findIndex(r => r.id === e.rank);
    overlay('rank', `<div class="stage rank-stage"><i class="rays"></i>${idx > 0 ? crest(idx - 1, idx - 1, 'old') : ''}${crest(idx, idx, 'new', idx >= 4)}<i class="flash"></i></div>
      <h2 class="big-word">RANK UP</h2>
      <p class="late">Rank Trial passed. You are now a <b>${e.rank}-rank</b> hunter.</p>
      <div class="rewards late">${rewardRows(e.unlocks.map(u => [u, '&#10003;']))}</div>
      <button class="btn primary wide late" data-act="close-modal" data-focus>Continue</button>`, 'center gold');
    setTimeout(() => { if (modal === 'rank') burstAt(layer.querySelector('.rank-stage'), { colors: goldSparks(), n: 80, speed: 520, gravity: 300, ttl: 1.4, size: 6 }); }, calm.matches ? 0 : 950);
    haptic('big');
  }

  function trialModal() {
    const tri = E.trialInfo(state);
    if (!tri.canStart) { toast('The Rank Trial is not open right now.', 'warn'); return; }
    const day = E.today(state), n = tri.next, idx = E.RANKS.indexOf(n);
    const rows = E.QUESTS.map(q => [q.name, fmt(q.id, Math.min(day.progress[q.id], n.trial[q.id])) + ' / ' + fmt(q.id, n.trial[q.id]) + unit(q.id)]);
    const more = E.QUESTS.filter(q => n.trial[q.id] > day.targets[q.id]).map(q => q.name.toLowerCase());
    overlay('trial', `<div class="label">Rank Trial</div>
      <div class="stage low"><i class="rays"></i>${crest(idx, idx, 'sealed')}</div>
      <h2 class="big-word mid">${n.id} RANK</h2>
      <div class="rewards">${rewardRows(rows)}</div>
      <p class="note">Reach these numbers before the day resets. What you already logged today counts. Not passing costs nothing, and you can try again after ${plural(T.trialRetryDays, 'day')}.${more.length ? ' It asks more than your quest for: ' + more.join(', ') + '.' : ''}</p>
      <button class="btn primary wide" data-act="trial-go" data-focus>Begin the trial</button>
      <button class="btn ghost wide" data-act="close-modal">Not today</button>`, 'center gold');
  }
  function restModal() {
    overlay('rest', `<div class="label">Rest token</div>
      <div class="stage low">${ob('token', 'big')}</div>
      <h2 class="big-word mid">REST TODAY?</h2>
      <p class="note">Today becomes a rest day. The streak is frozen: no XP, no chest, no penalty. The count toward your next token starts over. You can change your mind until the day resets.</p>
      <button class="btn primary wide" data-act="rest-go" data-focus>Use the token</button>
      <button class="btn ghost wide" data-act="close-modal">Train instead</button>`, 'center');
  }
  function hardModal() {
    overlay('hard', `<div class="label">Hard mode</div>
      ${sigil('skull')}
      <h2 class="big-word mid">NO SAFETY NET</h2>
      <div class="rewards">${rewardRows([['All XP', '+' + Math.round(T.hardBonus * 100) + '%'], ['Broken streak', 'Level bar wiped, -1 level'], ['Penalty extra task', 'Doubled'], ['Rank', 'Never lost']])}</div>
      <p class="note">You can switch it on now. Switching it off only takes effect after your current streak ends, so there is no quitting just before a fall.</p>
      <button class="btn primary wide" data-act="hard-go" data-focus>Take the oath</button>
      <button class="btn ghost wide" data-act="close-modal">Not yet</button>`, 'center warnwin');
  }

  // ---------- backup and restore windows ----------
  // The backup as text, for when no file can be handed over (inside Claude, or when sharing is refused).
  function backupTextModal(text) {
    overlay('bktext', `<div class="win-head">${ic('shield')}<div><h1 class="win-title small">Backup as text</h1><div class="win-sub">Your whole progress, to copy.</div></div></div>
      <div class="form">
        <p class="note">A file cannot be saved from here. Copy all of this text and keep it somewhere safe, such as a note or an email to yourself. To bring the progress back, paste it under Restore a backup.</p>
        <textarea class="field" id="bk-out" rows="5" readonly spellcheck="false" aria-label="Backup text">${esc(text)}</textarea>
        <button class="btn primary" data-act="backup-copy" data-focus>Copy the text</button>
        <button class="btn ghost" data-act="close-modal">Done</button>
      </div>`);
  }
  function restoreModal() {
    pending = null;
    overlay('restore', `<div class="win-head">${ic('shield')}<div><h1 class="win-title small">Restore a backup</h1><div class="win-sub">Continue from saved progress.</div></div></div>
      <div class="form">
        <p class="note">Choose the backup file you saved, or paste the backup text.</p>
        <button class="btn primary" data-act="backup-pick" data-focus>Choose a backup file</button>
        <input class="offscreen" type="file" id="bk-file" accept=".json,.txt,application/json,text/plain" tabindex="-1" aria-hidden="true">
        <label>Backup text<textarea class="field" id="bk-text" rows="4" placeholder="Paste it here" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea></label>
        <p class="note bad" id="bk-err" role="alert" hidden></p>
        <button class="btn" data-act="backup-read">Read the pasted text</button>
        <button class="btn ghost" data-act="backup-cancel">Cancel</button>
      </div>`);
  }
  function backupError(msg) {
    const el = $('#bk-err');
    if (el) { el.textContent = msg; el.hidden = false; } else toast(msg, 'warn');
  }
  // Reads a backup that was picked or pasted, and asks before anything is replaced.
  function tryBackup(text) {
    const res = readBackup(text);
    if (res.why) { backupError(res.why); return; }
    pending = res;
    const s = res.state, gap = Math.max(0, E.daysBetween(s.lastDay, todayKey()));
    const rows = [['Hunter', esc(s.name)], ['Rank and level', E.RANKS[s.rank].id + ' rank, level ' + s.level], ['Streak', plural(s.streak, 'day')], ['Total XP', num(s.totalXp)], ['Last played', dateLabel(s.lastDay)]];
    if (res.at) rows.push(['Backup made', dateLabel(E.dayKey(new Date(res.at)))]);
    const notes = [];
    if (state) notes.push('It replaces the progress on this device: <b>' + esc(state.name) + ', level ' + state.level + '</b>. That copy stays under System, Data for 30 days.');
    if (gap > 0) notes.push(plural(gap, 'day') + ' passed since this backup was last played. ' + (gap === 1 ? 'It is' : 'They are') + ' scored like any day away from training.');
    if (!notes.length) notes.push('You continue exactly where this backup stopped.');
    overlay('restore2', `<div class="label">Backup found</div>
      <div class="stage low"><i class="rays"></i>${crest(s.rank, E.auraOf(s))}</div>
      <h2 class="big-word mid">RESTORE?</h2>
      <div class="rewards">${rewardRows(rows)}</div>
      ${notes.map(n => `<p class="note">${n}</p>`).join('')}
      <button class="btn primary wide" data-act="backup-apply" data-focus>Restore this backup</button>
      <button class="btn ghost wide" data-act="backup-cancel">Cancel</button>`, 'center');
  }
  const fileText = f => f.text ? f.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });

  // ---------- screens ----------
  const myCrest = cls => crest(state.rank, E.auraOf(state), (cls || '') + (state.hard ? ' hard' : ''), state.rank >= 4);
  const noticeIcon = cls => /\bwarn\b/.test(cls) ? 'skull' : /\bok\b/.test(cls) ? 'clear' : /\bgold\b/.test(cls) ? 'trial' : 'system';
  const slug = t => String(t).replace(/<[^>]*>/g, '').replace(/[^a-z]+/gi, '').toLowerCase().slice(0, 40);
  // The parts every screen is built from. A screen is a title, at most one framed hero, and plain sections under it:
  // a heading with one quiet line beside it, then either a card or a list of rows on one surface.
  const banner = (cls, title, text, extra, icon) => `<div class="banner ${cls}" data-key="b-${slug(title)}">${ic(icon || noticeIcon(cls))}<div class="b-main"><h3>${title}</h3><p class="note">${text}</p>${extra || ''}</div></div>`;
  const opt = (title, text, act, label, cls, icon) => `<div class="opt ${cls || ''}" data-key="o-${slug(title)}">${icon || ''}<span class="o-main"><b>${title}</b><small>${text}</small></span>${act ? `<button class="btn small" data-act="${act}">${label}</button>` : label ? `<span class="tag dim">${label}</span>` : ''}</div>`;
  const head = (title, cap, side) => `<header class="scr-head" data-key="head"><div class="sh-text">${cap ? `<div class="sh-cap">${cap}</div>` : ''}<h1 class="win-title">${title}</h1></div>${side ? `<div class="sh-side">${side}</div>` : ''}</header>`;
  const sect = (title, body, side, key) => `<section class="sec" data-key="${key || 's-' + slug(title)}">${title ? `<div class="sec-head"><h2 class="sec-title">${title}</h2>${side ? `<span class="sec-side">${side}</span>` : ''}</div>` : ''}${body}</section>`;
  const card = (body, cls) => `<div class="card ${cls || ''}">${body}</div>`;
  const group = (items, cls) => `<div class="opts ${cls || ''}">${items.join('')}</div>`;

  function testBar() {
    return testing() ? `<div class="testbar"><span>Test clock <b>+${plural(state.debugOffset, 'day')}</b>. Nothing done here is kept.</span><button class="btn small" data-act="unskip">Back to today</button></div>` : '';
  }
  // A new version of the app is downloaded and waiting. Only the installable web app has versions.
  function updateBar() {
    return shell && shell.updateReady ? '<div class="testbar upd"><span>A new version of the app is ready.</span><button class="btn small" data-act="app-update">Update</button></div>' : '';
  }
  // Level and XP: the strip at the foot of the quest hero. "+12 XP" lands beside it.
  function levelStrip() {
    const need = E.xpForNext(state.level), max = !isFinite(need), lvUp = changed('hud-lv', state.level);
    return `<div class="xprow">${myCrest('mini')}<div class="xp-col">
        <div class="xp-top"><span class="pname">${esc(state.name)}</span><span class="plevel"${lvUp ? ' data-fx="bump"' : ''}>LV ${state.level}</span>${state.hard ? '<span class="tag-hard">HARD</span>' : ''}<span class="xpnum">${max ? 'MAX LEVEL' : `<b${lvUp ? '' : roll('hud-xp', state.xp, 'num', true)}>${num(state.xp)}</b> / ${num(need)} XP`}</span></div>
        <div class="bar xp">${fill('xp', max ? 1 : state.xp / need)}</div>
      </div></div>`;
  }
  // The one thing on the right of a screen's title.
  const streakPill = () => { const live = E.liveStreak(state); return `<span class="pill streak ${live.n ? 'hot' : ''}" role="img" aria-label="Streak ${live.n}">${ob('flame')}<span${roll('hud-streak', live.n)}>${live.n}</span></span>`; };
  const essencePill = () => `<span class="pill" role="img" aria-label="${state.essence} Essence">${ob('essence')}<span${roll('hud-ess', state.essence, 'num', true)}>${num(state.essence)}</span></span>`;
  // The small header that follows the page down once the top of the screen has scrolled away. On the quest screen it
  // holds the level bar, on the others the name of the screen. A tap on it goes back to the top.
  const TAB_NAME = { quest: 'Quest', hunter: 'Hunter', log: 'Log', hall: 'Hunter Hall', system: 'System' };
  function miniHud() {
    if (!mini) return;
    if (!state) { mini.innerHTML = ''; return; }
    if (tab !== 'quest') { morph(mini, `<div class="mini-in plain" data-key="mini-${tab}" data-act="top"><span class="mini-title">${TAB_NAME[tab]}</span></div>`); return; }
    const need = E.xpForNext(state.level), max = !isFinite(need), live = E.liveStreak(state), lvUp = changed('mini-lv', state.level);
    morph(mini, `<div class="mini-in" data-key="mini-quest" data-act="top">${myCrest('mini')}<span class="plevel"${lvUp ? ' data-fx="bump"' : ''}>LV ${state.level}</span>
      <div class="bar xp">${fill('mxp', max ? 1 : state.xp / need)}</div>
      <span class="pill ${live.n ? 'hot' : ''}">${ob('flame')}${live.n}</span></div>`);
    runFx(mini);
  }
  function countdown() {
    const n = now(), m = Math.max(0, Math.round((E.nextReset(n) - n) / 60000));
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }
  // A part of a screen that stays folded until it is asked for (data-act="fold"). Folded, it is inert.
  const fold = (key, body) => `<div class="fold${openDetails[key] ? ' open' : ''}" data-key="fold-${key}"${openDetails[key] ? '' : ' inert'}><div class="fold-in">${body}</div></div>`;

  // One quest row is open at a time. null follows the first unfinished task, 'none' closes them all.
  let qsel = null, qselDay = null;
  const openQuest = day => {
    if (qselDay !== state.lastDay) { qsel = null; qselDay = state.lastDay; } // the choice belongs to one day
    return qsel === 'none' ? null : E.QUEST_IDS.includes(qsel) ? qsel : (E.QUESTS.find(q => day.progress[q.id] < day.targets[q.id]) || {}).id || null;
  };
  // The seal a finished task gets on its medal.
  const stamp = key => `<i class="stamp"${changed(key, true) ? ' data-fx="stamp"' : ''}></i>`;

  function questScreen() {
    const day = E.today(state), live = E.liveStreak(state);
    const resting = day.kind === 'rest', paused = !!day.paused, logOn = E.canLog(state);
    const pen = day.penalty, penDone = E.penaltyDone(day);
    const doneN = E.QUESTS.filter(q => day.progress[q.id] >= day.targets[q.id]).length;
    const title = resting ? 'Rest Day' : paused ? 'Quest Paused' : pen ? 'Penalty Quest' : 'Daily Quest';
    const mood = resting ? 'rest' : paused ? 'paused' : pen && !penDone ? 'pen warnwin' : day.cleared ? 'cleared' : '';
    let out = head(title, `${dateLabel(state.lastDay)}<i class="sep"></i>resets in <span id="cd">${countdown()}</span>`, streakPill());

    // The hero: the one framed window of the screen, with the hunter in it. It carries today's score as a ring with the
    // marks of the daily track on it (no penalty from 25%, the streak grows from 75%, the chest waits at the end),
    // one line on what the score means, and the level bar.
    let core;
    if (logOn) {
      const sc = E.score(day);
      const hint = live.state === 'risk' ? 'Clear the quest and the extra task today, or the streak resets to 0.'
        : live.state === 'grown' ? (day.cleared ? 'Cleared. Today counts toward the streak.' : 'Past 75%: today counts toward the streak. Clear all four for the bonus and the chest.')
        : live.state === 'hold' ? 'The streak holds. Reach 75% to grow it.'
        : state.graceDay === state.lastDay ? 'You awakened today, so nothing is owed if you start tomorrow. After today, a day under 25% brings a Penalty Quest.'
        : sc > 0 ? 'Under 25% means a Penalty Quest tomorrow.' : 'Nothing logged yet. A missed day means a Penalty Quest tomorrow.';
      const mark = (key, at, icon, label) => { const lit = sc >= at; return `<span class="ring-mark${lit ? ' lit' : ''}"${changed(key, lit) && lit ? ' data-fx="node"' : ''} style="--at:${at}" role="img" aria-label="${label}">${icon}</span>`; };
      core = `<div class="ring${day.cleared ? ' ok' : ''}${sc > 0 ? '' : ' zero'}" style="--p:${Math.round(sc * 1000) / 10}">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fg" cx="60" cy="60" r="52" pathLength="100"/></svg>
          ${pen ? '' : mark('n1', T.partial, ic('shield'), 'No penalty from ' + pct(T.partial)) + mark('n2', T.nearClear, ob('flame'), 'The streak grows from ' + pct(T.nearClear))}
          <span class="ring-mark chest${day.cleared ? ' lit' : ''}"${changed('tk-chest', !!day.cleared) && day.cleared ? ' data-fx="lit"' : ''} style="--at:1" role="img" aria-label="${day.cleared ? 'Chest claimed' : 'A chest waits at 100%'}">${ob(day.cleared ? 'chest-open' : 'chest-closed')}</span>
          <div class="ring-in"><b class="tk-pct"${roll('tk-pct', Math.round(sc * 100), 'pct', true)}>${pct(sc)}</b><small>of today&#39;s quest</small></div>
        </div>
        <p class="note" id="q-hint">${hint}</p>`;
    } else if (resting) {
      core = `<div class="hero-idle">${ob('token')}</div>
        <p class="note">A rest token is holding your streak. No XP today and no penalty tomorrow.</p>
        <button class="btn small" data-act="rest-cancel">Train after all</button>`;
    } else {
      core = `<div class="hero-idle">${ic('shield')}</div>
        <p class="note">The quest and the streak are paused, and nothing is lost while you recover. Today's quest stays at ${quest4(day.targets)}.</p>
        <button class="btn small" data-act="pause-off">I am ready to train</button>`;
    }
    out += `<section class="hero hud aura-${E.auraOf(state)} ${mood}" data-key="hud">
      <div class="ka-art"><i class="ka-scene"></i>${figure(state.rank >= 4)}<i class="ka-scrim"></i></div>
      <div class="hero-main">${core}</div>
      ${levelStrip()}
    </section>`;

    if (logOn) {
      // What is special about today, one notice each.
      if (state.paused) out += banner('', 'Pause starts tomorrow', 'Today was already cleared, so it counts. From tomorrow the quest and the streak are paused.', '<button class="btn small" data-act="pause-off">Cancel the pause</button>', 'shield');
      if (pen) out += penDone
        ? banner('ok', 'Penalty served', 'Quest and extra task are done. The streak carries on.')
        : banner('warn', 'Extra task today', penaltyText(pen) + '.' + (state.hard ? ' Hard mode doubled it.' : ''));
      if (day.trial) out += day.trial.passed
        ? banner('gold', 'Rank Trial passed', 'You hold ' + E.RANKS[day.trial.rank].id + ' rank.')
        : banner('gold', 'Rank Trial: ' + E.RANKS[day.trial.rank].id + ' rank', 'Reach ' + quest4(day.trial.req) + ' before the reset. Everything you log today counts. Not passing costs nothing.');
      if (day.cleared && (!day.felt || openDetails.felt)) out += banner('ok', 'How did it feel?', 'Your answer steers how fast the quest grows.', feltButtons(day));

      const focusOn = state.skills.includes('splitFocus'), open = openQuest(day);
      // Every card carries its controls; a closed card folds them away (and makes them inert), so opening and
      // closing is one smooth height change instead of a jump.
      const list = E.QUESTS.map(q => {
        const id = q.id, p = day.progress[id], t = day.targets[id], done = p >= t, isRun = id === 'run', share = Math.min(1, p / t), isOpen = id === open;
        const top = `<span class="q-med" style="--p:${Math.round(share * 1000) / 10}">${ic(id)}${done ? stamp('s-' + id) : (changed('s-' + id, false), '')}</span>
          <span class="q-name">${q.name}${id === 'pushups' && state.test.knee ? ' (knee)' : ''}</span>
          <span class="q-count"><b class="q-n"${roll('c-' + id, r2(p), isRun ? 'run' : '', true)}${changed('cb-' + id, r2(p)) ? ' data-fx="bump"' : ''}>${fmt(id, p)}</b><small> / ${fmt(id, t)}${unit(id)}</small></span>`;
        const cap = isRun ? r2(t * (1 + T.overflowCap)) : Math.floor(t * (1 + T.overflowCap) + 1e-9);
        const notes = [];
        if (day.trial && !day.trial.passed && p < day.trial.req[id]) notes.push('Trial: ' + fmt(id, day.trial.req[id]) + unit(id) + ' needed, ' + fmt(id, r2(day.trial.req[id] - p)) + unit(id) + ' to go.');
        if (pen && pen.type === 'extra' && pen.id === id) notes.push(p >= pen.need ? 'Penalty extra done.' : 'Penalty: ' + fmt(id, pen.need) + unit(id) + ' today, ' + fmt(id, r2(pen.need - p)) + unit(id) + ' to go.');
        if (isRun && !done && day.tiers.run <= 2) notes.push('Walk-run intervals count at this tier. Cover the distance.');
        if (isRun && state.pace.best == null) notes.push('Add the minutes for a run of 1 km or more and it counts toward your pace and Agility.');
        if (done) notes.push(p < cap ? 'Extra work up to ' + fmt(id, cap) + unit(id) + ' earns bonus XP at ' + (day.overdrive ? 'full rate (Overdrive).' : 'half rate.') : 'Bonus XP is maxed for today.');
        const btns = isRun
          ? `<button class="btn grow" data-act="add" data-id="run" data-n="0.5">+0.5 km</button>
             <button class="btn grow" data-act="add" data-id="run" data-n="1">+1 km</button>
             <div class="addrow full">
               <input class="field" id="in-run" inputmode="decimal" placeholder="km" aria-label="Run distance in km" enterkeyhint="done">
               <input class="field" id="in-runmin" inputmode="decimal" placeholder="min" aria-label="Run time in minutes, optional" enterkeyhint="done">
               <button class="btn" data-act="add-custom" data-id="run">Add</button>
             </div>`
          : `<button class="btn grow" data-act="add" data-id="${id}" data-n="1">+1</button>
             <button class="btn grow" data-act="add" data-id="${id}" data-n="5">+5</button>
             <button class="btn grow" data-act="add" data-id="${id}" data-n="10">+10</button>
             <button class="btn grow tapbtn" data-act="tap" data-id="${id}" aria-label="Tap counter"><i class="tap-ic"></i>Tap</button>
             <div class="addrow full">
               <input class="field" id="in-${id}" inputmode="numeric" placeholder="reps" aria-label="${q.name} amount" enterkeyhint="done">
               <button class="btn" data-act="add-custom" data-id="${id}">Add</button>
             </div>`;
        return `<div class="quest${isOpen ? ' act' : ''}${done ? ' done' : ''}" data-key="q-${id}" data-id="${id}">
          <button class="q-head" data-act="pick" data-id="${id}" aria-expanded="${isOpen}">${top}</button>
          <div class="q-more"${isOpen ? '' : ' inert'}><div class="q-in">
            <div class="q-btns">${btns}</div>
            ${notes.map(n => `<p class="note">${n}</p>`).join('')}
            <div class="q-tags"><span>${STAT[q.stat]}</span><span>Tier ${day.tiers[id]}</span><span>XP x${E.multOf(day.tiers[id])}</span>${focusOn ? `<button class="chiplet ${day.focus === id ? 'on' : ''}" data-act="focus" data-id="${id}">Focus x2</button>` : ''}</div>
          </div></div>
        </div>`;
      }).join('');

      let plankRow = '';
      if (pen && pen.type === 'plank') {
        const pd = pen.done >= pen.need, share = Math.min(1, pen.done / pen.need);
        plankRow = `<div class="quest pen act ${pd ? 'done' : 'warn'}" data-key="q-plank">
          <div class="q-head">
            <span class="q-med" style="--p:${Math.round(share * 100)}">${ic('time')}${pd ? stamp('s-plank') : (changed('s-plank', false), '')}</span>
            <span class="q-name">Plank</span>
            <span class="q-count"><b class="q-n"${changed('cb-plank', pen.done) ? ' data-fx="bump"' : ''}>${mmss(pen.done)}</b><small> / ${mmss(pen.need)}</small></span>
          </div>
          <div class="q-more"><div class="q-in">
            <div class="q-btns">
              <button class="btn grow" data-act="plank-timer">Timer</button>
              <button class="btn grow" data-act="plank-add" data-n="30">+30 s</button>
              <button class="btn grow" data-act="plank-add" data-n="60">+1 min</button>
            </div>
            ${pd ? '' : '<p class="note">Penalty task. Total time counts: it does not have to be one hold.</p>'}
          </div></div>
        </div>`;
      }
      const earned = Math.round(Number(day.xp) || 0);
      out += sect('Tasks', `<div class="quests" data-key="quests">${list}${plankRow}</div>
        <div class="tasks-foot" data-key="foot">
          <div class="row foot">
            <button class="foldbtn" data-act="fold" data-id="xp" aria-expanded="${!!openDetails.xp}">Earned today <b><span${roll('day-xp', earned, '', true)}>${earned}</span> XP</b><i class="chev"></i></button>
            ${day.log && day.log.length ? '<button class="btn ghost small" data-act="undo">Undo last</button>' : ''}
          </div>
          ${fold('xp', `<div class="rewards">${rewardRows(xpRows(E.breakdown(state, day), day))}</div>`)}
        </div>`, doneN + ' of ' + E.QUESTS.length + ' done', 'tasks');
    }

    // What else can be done today. Only what can be acted on shows here: where a rank or a token stands is on the
    // Hunter and Log screens.
    const opts = [];
    const tri = E.trialInfo(state);
    if (tri.canStart) { const ri = E.RANKS.indexOf(tri.next); opts.push(opt('Rank Trial: ' + tri.next.id + ' rank', quest4(tri.next.trial) + ' in one day. What you logged today counts.', 'trial', 'Start', 'gold', crest(ri, ri, 'mini'))); }
    const rest = E.restInfo(state);
    if (!rest.resting && rest.tokens) opts.push(opt('Rest token', rest.canUse ? 'Freeze the streak today: no XP and no penalty.' : rest.why, rest.canUse ? 'rest' : null, rest.canUse ? 'Rest today' : 'Held', '', ob('token')));
    const od = E.overdriveInfo(state);
    if (od.equipped && (od.active || od.canUse)) opts.push(opt('Overdrive', od.active ? 'Active today: extra work pays at full rate.' : 'Once a week, extra work up to 120% pays at full rate.', od.canUse ? 'overdrive' : null, od.active ? 'Active' : 'Activate', od.active ? 'on' : '', ob('rune')));
    if (E.retestDue(state)) opts.push(opt('Awakening Test', 'Four weeks since your last test. Re-test to place your quest again.', 'retest', 'Re-test', '', ic('trial', 'o-ic')));
    if (logOn && day.cleared && day.felt && !openDetails.felt) opts.push(`<div class="opt" data-key="o-felt">${ic('clear', 'o-ic')}<span class="o-main"><b>It felt: ${FELT[day.felt].toLowerCase()}</b><small>Rest, or keep going: extra work still earns XP.</small></span><button class="btn small" data-act="fold" data-id="felt">Change</button></div>`);
    if (opts.length) out += sect('Also today', group(opts), '', 'today');
    return out;
  }

  // How the weekly check on the quest size stands.
  function growth() {
    if (E.isFullRoutine(state.targets)) return 'You are at the full routine. The quest does not grow past this.';
    const k = state.lastDay;
    let from = E.addDays(k, -(T.rampWindow - 1));
    if (state.adjustDay > from) from = state.adjustDay;
    let clears = 0;
    for (let d = from; d <= k; d = E.addDays(d, 1)) {
      const day = state.days[d];
      if (day && (d === k ? day.cleared : day.result === 'clear')) clears++;
    }
    const left = T.rampWindow - (E.daysBetween(state.adjustDay, k) + 1);
    return 'Clear ' + T.rampClears + ' of the last ' + T.rampWindow + ' days and each task grows by about 10%, at most once a week, stopping at each tier. This week: ' + plural(clears, 'clear') + (left > 0 ? ', next check in ' + plural(left, 'day') + '.' : ', checked at the next reset.');
  }

  // What on the Hunter screen is waiting for a decision, by sub-view.
  function hunterDots() {
    const freeSkill = E.skillSlots(state) > state.skills.length && E.SKILLS.some(k => !k.inactive && state.level >= k.level && !state.skills.includes(k.id));
    return { card: E.trialInfo(state).canStart, skills: freeSkill };
  }

  function cardView() {
    const st = E.stats(state), rank = E.RANKS[state.rank], aura = E.auraOf(state);
    const t = E.TITLES.find(x => x.id === state.title);
    const frame = E.ITEMS.some(i => i.kind === 'frame' && i.id === state.frame) ? state.frame : '';
    const need = E.xpForNext(state.level), max = !isFinite(need);
    // The licence is the one framed window of this screen: who the hunter is, and the level.
    const licence = `<div class="pcard aura-${aura} ${frame}" data-key="pcard">
      <div class="pc-art">${figure(state.rank >= 4)}<i class="pc-sheen"></i></div>
      <span class="label">Hunter licence</span>
      <div class="pc-main">
        ${myCrest('big')}
        <div class="pc-id">
          <div class="pc-name">${esc(state.name)}</div>
          <div class="pc-title">${t ? esc(t.name) : 'No title'}</div>
          <div class="pc-rank">${rank.id} rank<i class="sep"></i>${E.AURAS[aura]} aura</div>
          ${state.hard ? '<span class="tag-hard">HARD MODE</span>' : ''}
        </div>
      </div>
      <div class="pc-low">
        <div class="xp-top"><span class="plevel">LV ${state.level}</span><span class="xpnum">${max ? 'MAX LEVEL' : num(state.xp) + ' / ' + num(need) + ' XP'}</span></div>
        <div class="bar xp">${fill('pc-xp', max ? 1 : state.xp / need)}</div>
      </div>
    </div>`;

    const statRow = (k, v, p, text) => `<div class="statx"><div class="stat">${ic(k.toLowerCase())}<span>${STAT[k]}</span><b>${v}</b></div><div class="bar">${fill('st-' + k, p)}</div><small class="note">${text}</small></div>`;
    const strP = (T.strPer - st.strLeft) / T.strPer, sitP = (T.endSitPer - st.sitLeft) / T.endSitPer, runP = (T.endRunPer - st.runLeft) / T.endRunPer, agiP = (T.agiRuns - st.paceRunsLeft) / T.agiRuns;
    const agiText = state.pace.best != null
      ? 'Best pace ' + mmss(state.pace.best) + ' per km. ' + plural(st.paceRunsLeft, 'more timed run') + ' near it, or ' + T.agiPaceStep + ' seconds off it, for the next point.'
      : 'Log a run of 1 km or more with its time to start tracking pace.';
    const stats = sect('Stats', card(
      statRow('STR', st.STR, strP, st.strLeft + ' more push-ups or squats to the next point.')
      + statRow('END', st.END, Math.max(sitP, runP), st.sitLeft + ' sit-ups or ' + fmt('run', st.runLeft) + ' km to the next point.')
      + statRow('AGI', st.AGI, agiP, agiText), 'list'), 'Grow only from training');

    const tri = E.trialInfo(state);
    const ladder = E.RANKS.map((r, i) => `<div class="rung ${i <= state.rank ? 'got' : ''} ${i === state.rank ? 'cur' : ''}">${crest(i, i, i <= state.rank ? '' : 'sealed')}<small>Lv ${r.level}</small></div>`).join('');
    let climb;
    if (!tri.next) climb = `<p class="note">You hold the highest rank. Level ${E.MAX_LEVEL} is the cap.</p>`;
    else {
      const rows = [['Level ' + tri.next.level, tri.levelOk ? 'Reached' : 'You are level ' + state.level], ['Rank Trial, in one day', quest4(tri.next.trial)], ['Unlocks', tri.next.unlocks.join(', ')]];
      const when = tri.active ? 'The trial is running today.' : tri.wait ? 'The trial opens again in ' + plural(tri.wait, 'day') + '.' : tri.levelOk && !tri.canStart ? 'The trial can be started on a day you train.' : '';
      climb = `<div class="rewards">${rewardRows(rows)}</div>${when ? `<p class="note">${when}</p>` : ''}
        ${tri.canStart ? '<button class="btn gold" data-act="trial">Start the ' + tri.next.id + '-rank trial</button>' : ''}`;
    }
    const ranks = sect('Rank', card(`<div class="ladder">${ladder}</div>${climb}`), tri.next ? 'Next: ' + tri.next.id + ' rank' : 'Highest rank');

    const auraPick = state.rank >= 1 ? sect('Aura', `<div class="swatches">
        <button class="swatch auto ${state.aura == null ? 'on' : ''}" data-act="aura" data-id="auto" aria-label="Follow my rank">Auto</button>
        ${E.AURAS.slice(0, state.rank + 1).map((n, i) => `<button class="swatch aura-${i} ${state.aura === i ? 'on' : ''}" data-act="aura" data-id="${i}" aria-label="${n} aura" title="${n}"></button>`).join('')}
      </div>`, 'One colour for every rank you have held') : '';
    return licence + stats + ranks + auraPick;
  }

  function titlesView() {
    const item = t => {
      const has = state.titles.includes(t.id), on = state.title === t.id;
      return `<button class="title-item ${has ? '' : 'locked'} ${on ? 'on' : ''}" data-key="t-${t.id}" data-act="title" data-id="${t.id}" ${has ? '' : 'disabled'}>
        ${ic(has ? 'star' : 'lock', 'o-ic')}<span class="o-main"><b>${has ? esc(t.name) : esc(t.desc)}${t.hard ? ' <i class="tag-hard">HARD</i>' : ''}</b>${has ? `<small>${esc(t.desc)}</small>` : ''}</span>
        ${on ? '<span class="tag">In use</span>' : ''}</button>`;
    };
    const mine = E.TITLES.filter(t => state.titles.includes(t.id)), rest = E.TITLES.filter(t => !state.titles.includes(t.id));
    return sect('Your titles', group(mine.map(item)), mine.length + ' of ' + E.TITLES.length, 's-mine')
      + (rest.length ? sect('Still to earn', group(rest.map(item)), '', 's-locked') : '');
  }

  function skillsView() {
    const slots = E.skillSlots(state), used = state.skills.length, od = E.overdriveInfo(state);
    const items = E.SKILLS.map(k => {
      const on = state.skills.includes(k.id), lvOk = state.level >= k.level;
      let right;
      if (k.inactive) right = '<span class="tag dim">Later</span>';
      else if (on) right = `<button class="btn small" data-act="skill-off" data-id="${k.id}">Remove</button>`;
      else if (!lvOk) right = `<span class="tag dim">Lv ${k.level}</span>`;
      else if (used >= slots) right = `<span class="tag dim">${slots ? 'Slots full' : 'D rank'}</span>`;
      else right = `<button class="btn small" data-act="skill-on" data-id="${k.id}">Equip</button>`;
      const more = k.inactive ? ' Needs bonus tasks, which are not designed yet.' : on && k.id === 'overdrive' && od.wait ? ' Ready again in ' + plural(od.wait, 'day') + '.' : '';
      return `<div class="opt ${on ? 'on' : ''} ${!lvOk || k.inactive ? 'locked' : ''}" data-key="sk-${k.id}">${ob('rune')}<span class="o-main"><b>${k.name}</b><small>${k.desc}${more}</small></span>${right}</div>`;
    });
    const pips = Array.from({ length: 3 }, (x, i) => `<i class="pip ${i < used ? 'full' : i < slots ? 'free' : ''}"></i>`).join('');
    return sect('Skill slots', `<div class="slots"><div class="pips">${pips}</div><p class="note">Slots open with rank: one at D, two at C, three at A. Skills can be swapped at any time.</p></div>`, used + ' of ' + slots + ' in use', 's-slots')
      + sect('Skills', group(items), 'Unlock by level');
  }

  function shopView() {
    const item = it => {
      const owned = state.items.includes(it.id), on = state[it.kind] === it.id, rankOk = state.rank >= it.rank, key = 'buy:' + it.id;
      let right;
      if (on) right = '<span class="tag">In use</span>';
      else if (owned) right = `<button class="btn small" data-act="equip" data-kind="${it.kind}" data-id="${it.id}">Use</button>`;
      else if (!rankOk) right = `<span class="tag dim">${E.RANKS[it.rank].id} rank</span>`;
      else right = `<button class="btn small ${armed === key ? 'on' : ''}" data-act="buy" data-id="${it.id}" ${state.essence >= it.cost ? '' : 'disabled'}>${armed === key ? 'Confirm' : 'Buy'}</button>`;
      return `<div class="opt ${on ? 'on' : ''}" data-key="it-${it.id}"><span class="sw ${it.id}"></span><span class="o-main"><b>${it.name}</b><small>${owned ? 'Owned' : ob('essence') + num(it.cost)}</small></span>${right}</div>`;
    };
    const base = (kind, name) => `<div class="opt ${state[kind] ? '' : 'on'}" data-key="it-${kind}"><span class="sw ${kind}-default"></span><span class="o-main"><b>${name}</b><small>Standard issue</small></span>${state[kind] ? `<button class="btn small" data-act="equip" data-kind="${kind}" data-id="">Use</button>` : '<span class="tag">In use</span>'}</div>`;
    return sect('Themes', group([base('theme', 'System Blue')].concat(E.ITEMS.filter(i => i.kind === 'theme').map(item))), 'Recolour the whole app')
      + sect('Card frames', group([base('frame', 'Plain')].concat(E.ITEMS.filter(i => i.kind === 'frame').map(item))), 'From B rank')
      + '<p class="note fine">Every cleared quest drops a chest with Essence, and now and then a cosmetic. Streak milestones pay more. Nothing here makes you stronger.</p>';
  }

  function hunterScreen() {
    const subs = [['card', 'Card'], ['titles', 'Titles'], ['skills', 'Skills'], ['shop', 'Shop']];
    const dots = hunterDots(), si = Math.max(0, subs.findIndex(s => s[0] === sub));
    // One light glides to the part that was picked (--si is its index).
    return head('Hunter', E.RANKS[state.rank].id + ' rank<i class="sep"></i>Level ' + state.level, essencePill())
      + `<div class="subtabs" role="tablist" data-key="subtabs" style="--si:${si};--sn:${subs.length}"><i class="seg-ind"></i>${subs.map(([k, n]) => `<button class="subtab${dots[k] && sub !== k ? ' dot' : ''}" role="tab" aria-selected="${sub === k}" data-act="sub" data-id="${k}">${n}</button>`).join('')}</div>`
      + `<div class="subview" data-key="sub-${sub}"${changed('sub', sub) ? ' data-fx="enter"' : ''}>${sub === 'titles' ? titlesView() : sub === 'skills' ? skillsView() : sub === 'shop' ? shopView() : cardView()}</div>`;
  }

  // What a day shows as in the log. Today only shows a result it has already reached.
  function dayResult(k) {
    const d = state.days[k];
    if (!d) return '';
    if (k !== state.lastDay) return d.result || E.resultOf(d);
    const r = E.resultOf(d);
    return r === 'missed' || r === 'weak' ? '' : r;
  }
  const dayScore = d => !d ? 0 : d.score != null ? d.score : d.kind === 'quest' ? E.score(d) : 0;
  // The day that is picked in the calendar: its result, the four tasks as small rings, and what else happened.
  function dayDetail(k) {
    const d = state.days[k], isToday = k === state.lastDay, res = dayResult(k), quest = d.kind === 'quest';
    const open = isToday && !d.cleared && quest && !d.paused;
    const tasks = quest ? `<div class="day-tasks">${E.QUESTS.map(q => {
      const p = d.progress[q.id], t = d.targets[q.id];
      return `<div class="dt${p >= t ? ' done' : ''}"><span class="q-med" style="--p:${Math.round(Math.min(1, p / t) * 100)}">${ic(q.id)}</span><b>${fmt(q.id, p)}</b><small>of ${fmt(q.id, t)}${unit(q.id)}</small></div>`;
    }).join('')}</div>` : '';
    const rows = [];
    if (k === state.graceDay && !isToday && (res === 'missed' || res === 'weak')) rows.push(['Day of the Awakening Test', 'No penalty']);
    if (d.penalty) rows.push(['Penalty extra', penaltyText(d.penalty) + (E.penaltyDone(d) ? ', done' : isToday ? '' : ', not done')]);
    if (d.trial) rows.push(['Rank Trial', E.RANKS[d.trial.rank].id + (d.trial.passed ? ', passed' : isToday ? ', running' : ', not passed')]);
    if (d.felt) rows.push(['Felt', FELT[d.felt]]);
    rows.push(['XP', Math.round(Number(d.xp) || 0), 'sum']);
    return `<div class="card day" data-key="day"${changed('log-day', k) ? ' data-fx="enter"' : ''}>
      <div class="day-top"><b class="day-name">${dateLabel(k)}${isToday ? '<span class="tag">Today</span>' : ''}</b><span class="res ${open || !res ? '' : 'r-' + res}">${open ? 'In progress' : RESULT[res] || 'In progress'}${quest && !(d.paused && !d.cleared) ? '<i class="sep"></i>' + pct(dayScore(d)) : ''}</span></div>
      ${tasks}
      <div class="rewards">${rewardRows(rows)}</div>
    </div>`;
  }
  function logScreen() {
    const tk = state.lastDay, d = E.parseKey(tk), today = E.today(state), live = E.liveStreak(state), best = Math.max(state.best, live.n);
    const start = E.addDays(tk, -((d.getDay() + 6) % 7) - 28);
    const sel = state.days[logSel] ? logSel : tk;
    // Each day is a ring that closes as far as the day got. A cleared day is filled in.
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<div class="dow">${x}</div>`).join('');
    for (let i = 0; i < 35; i++) {
      const k = E.addDays(start, i), day = state.days[k], future = k > tk, res = future ? '' : dayResult(k);
      const p = future || !day ? 0 : Math.round(Math.min(1, dayScore(day)) * 100);
      cells += `<button class="cell ${future ? 'future' : res ? 'r-' + res : ''} ${k === tk ? 'today' : ''} ${k === sel ? 'sel' : ''}" style="--p:${p}" data-act="day" data-id="${k}" ${day && !future ? '' : 'disabled'} aria-label="${dateLabel(k)}${res ? ', ' + RESULT[res] : ''}"><span>${Number(k.slice(8))}</span></button>`;
    }
    const lg = (cls, name, p) => `<span><i class="cell ${cls}" style="--p:${p}"></i>${name}</span>`;
    const clears = state.clears + (today.cleared ? 1 : 0);
    const calendar = `<div class="card cal-card" data-key="cal"><div class="cal">${cells}</div>
      <div class="legend">${lg('r-clear', 'Clear', 100)}${lg('r-partial', 'Partly done', 60)}${lg('r-missed', 'Missed', 0)}${lg('r-rest', 'Rest', 0)}</div></div>`;

    const next = E.MILESTONES.find(m => !state.milestones.includes(m.days));
    const stones = E.MILESTONES.map(m => { const got = state.milestones.includes(m.days); return `<div class="stone ${got ? 'got' : ''}">${ob('flame')}<b>${m.days}</b><small>days</small></div>`; }).join('');
    const rest = E.restInfo(state);
    const streak = sect('Streak', card(`<div class="streak-now ${live.n ? 'hot' : ''}">${ob('flame')}<div class="sn-main"><b${roll('log-streak', live.n)}>${live.n}</b><small>${live.n === 1 ? 'day' : 'days'} in a row</small></div><div class="sn-side"><small>Best</small><b>${best}</b></div></div>
        <div class="stones">${stones}</div>
        <p class="note">${next ? 'Next milestone at ' + plural(next.days, 'day') + ': ' + next.essence + ' Essence and a title.' : 'Every milestone is reached.'}</p>`)
      + group([`<div class="opt" data-key="s-token">${ob('token', rest.tokens ? '' : 'faded')}<span class="o-main"><b>Rest tokens</b><small>${rest.tokens >= rest.cap ? 'You hold as many as you can carry. One freezes the streak for a day.' : 'One freezes the streak for a day. ' + rest.run + ' of ' + rest.every + ' clears in a row toward the next.'}</small></span><span class="tag ${rest.tokens ? '' : 'dim'}">${rest.tokens} / ${rest.cap}</span></div>`]),
      live.state === 'risk' ? 'At risk today' : live.state === 'frozen' ? 'Frozen today' : '');

    const path = E.QUESTS.map(q => `<div class="stat">${ic(q.id)}<span>${q.name}</span><b>${fmt(q.id, state.targets[q.id])}<small> / ${q.max}${unit(q.id)}</small></b></div><div class="bar">${fill('rd-' + q.id, state.targets[q.id] / q.max)}</div>`).join('');
    const road = sect('Road to the full routine', card(`<div class="road">${path}</div><p class="note">${growth()}</p>`));

    const tot = state.totals;
    const cell = (label, value) => `<div class="kvc"><b>${value}</b><span>${label}</span></div>`;
    const life = sect('Lifetime', card(`<div class="kv">
        ${cell('Push-ups', num(tot.pushups))}${cell('Sit-ups', num(tot.situps))}${cell('Squats', num(tot.squats))}
        ${cell('Run, km', fmt('run', tot.run))}${cell('Total XP', num(state.totalXp))}${cell('Clears', num(clears))}
        ${cell('Full routine', num(state.fullClears))}${cell('Penalties served', num(state.penaltyClears))}${cell('Best streak', best)}
      </div>`), 'Since ' + dateLabel(state.created));

    return head('Log', plural(clears, 'clear') + '<i class="sep"></i>best streak ' + best)
      + sect('Last five weeks', calendar + dayDetail(sel), 'Tap a day', 's-cal')
      + streak + road + life;
  }

  function hallScreen() {
    const h = E.hallInfo(state), rank = E.RANKS[state.rank], open = h.state === 'open';
    const req = (ok, key, title, text, p, right) => `<div class="opt ${ok ? 'ok' : ''}" data-key="h-${key}">${ic(ok ? 'clear' : 'lock', 'o-ic')}<span class="o-main"><b>${title}</b><small>${text}</small><div class="bar">${fill('h-' + key, p)}</div></span><span class="tag ${ok ? '' : 'dim'}">${right}</span></div>`;
    let lead, body;
    if (h.state === 'sealed') {
      lead = 'The Hall opens to hunters who hold ' + h.rankNeed + ' rank and have kept a ' + h.streakNeed + '-day streak. Both.';
      body = sect('To enter', group([
        req(h.rankOk, 'rank', h.rankNeed + ' rank', 'You hold ' + rank.id + ' rank.', state.rank / T.hallRank, h.rankOk ? 'Done' : rank.id + ' / ' + h.rankNeed),
        req(h.streakOk, 'streak', h.streakNeed + '-day streak', 'Your best streak is ' + plural(h.best, 'day') + '.', h.best / h.streakNeed, h.streakOk ? 'Done' : h.best + ' / ' + h.streakNeed),
      ]), 'Checked at the daily reset');
    } else if (open) {
      const t = E.TITLES.find(x => x.id === state.title);
      lead = 'You earned your place. For now you stand here alone: other hunters arrive with the iOS app.';
      body = sect('In the Hall', group([`<div class="opt on" data-key="h-you">${myCrest('mini')}<span class="o-main"><b>${esc(state.name)}</b><small>${t ? esc(t.name) + ', ' : ''}${rank.id} rank, level ${state.level}</small></span><span class="tag">You</span></div>`]), '1 hunter')
        + `<p class="note">Stay active. The Hall locks after ${h.idleMax} days without a cleared quest. Days since your last clear: <b>${h.idle}</b>.</p>`;
    } else {
      lead = h.idleMax + ' days passed without a cleared quest. Clear ' + h.clearsNeed + ' quests and the Hall opens again.';
      body = sect('To reopen', group([req(false, 'clears', 'Clear ' + plural(h.clearsNeed, 'quest'), h.clears + ' cleared since the lock.', h.clears / h.clearsNeed, h.clears + ' / ' + h.clearsNeed)]));
    }
    return head('Hunter Hall', 'Where ranked hunters meet')
      + `<section class="hero hall ${h.state}${h.state === 'locked' ? ' warnwin' : ''}" data-key="hall">
          <div class="ka-art"><i class="ka-scene"></i><i class="ka-scrim"></i></div>
          <div class="hall-main">${ic(open ? 'hall' : 'lock', 'hall-ic')}<h2 class="hall-state">${open ? 'Open' : h.state === 'locked' ? 'Locked' : 'Sealed'}</h2><p class="note">${lead}</p></div>
        </section>`
      + body
      + '<p class="note fine">In this version the Hall is only its gate. Rankings, friends and guilds need accounts and a server, so they come with the iOS app.</p>';
  }

  // How to put the app on the home screen, for someone who is still in a browser tab. Empty when there is nothing to say.
  function installNote() {
    if (!shell || shell.standalone) return '';
    if (shell.canInstall) return banner('', 'Install the app', 'It gets its own icon, opens full screen and works without a connection. Your progress stays as it is.', '<button class="btn small" data-act="app-install">Install</button>', 'star');
    if (!shell.ios) return '';
    return banner('', 'Add it to your Home Screen', 'In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>, and open Ascend from its icon. '
      + (state ? 'The app there starts empty. To take this progress along, save a backup here and restore it there.' : 'Do this before you start: the app on the Home Screen keeps its own progress.'), '', 'star');
  }

  // Settings are lists of rows: what it is, one sentence on it, and its one control.
  const setRow = (key, title, text, right, cls) => `<div class="opt ${cls || ''}" data-key="s-${key}"><span class="o-main"><b>${title}</b><small>${text}</small></span>${right || ''}</div>`;
  const rowBtn = (act, label, cls) => `<button class="btn small ${cls || ''}" data-act="${act}">${label}</button>`;
  function systemScreen() {
    const since = E.daysBetween(state.testDay, state.lastDay), due = E.retestDue(state), bonus = Math.round(T.hardBonus * 100);
    const training = [
      state.hard
        ? setRow('hard', 'Hard mode is on', state.hardOffPending ? 'It switches off when your current streak ends.' : 'All XP +' + bonus + '%. A broken streak wipes the level bar and costs one level, and the penalty task is doubled. Rank is never lost.',
            state.hardOffPending ? rowBtn('hard-keep', 'Keep it on') : rowBtn('hard-off', 'Switch off'), 'warn')
        : setRow('hard', 'Hard mode', 'All XP +' + bonus + '%, its own titles and a marked emblem. The price: a broken streak wipes the level bar and costs one level.', rowBtn('hard-on', 'Switch on')),
      state.paused
        ? setRow('pause', 'Paused', 'Quest and streak are frozen. There is no penalty while you recover.', rowBtn('pause-off', 'Resume'), 'on')
        : setRow('pause', 'Injured or sick', 'Pause the quest and the streak for as long as you need. Nothing is lost.', rowBtn('pause-on', 'Pause')),
      setRow('test', 'Awakening Test', (due ? '<b>A re-test is due.</b> ' : '') + 'Last taken ' + dateLabel(state.testDay) + (since ? ', ' + plural(since, 'day') + ' ago' : '') + '. It places each task again, and stats never go down.', rowBtn('retest', 'Re-test', due ? 'gold' : '')),
    ];
    let appPart = '';
    if (shell) {
      const where = (shell.standalone ? 'Installed on this device.' : 'Running in the browser.') + (shell.offline ? ' It opens without a connection.' : '');
      appPart = sect('App', group([shell.updateReady
        ? setRow('app', 'A new version is ready', 'Updating takes a moment and keeps your progress. ' + where, rowBtn('app-update', 'Update now', 'gold'), 'on')
        : setRow('app', 'Version ' + esc(shell.version), (shell.built ? 'From ' + dateLabel(shell.built) + '. ' : '') + where, rowBtn('app-check', 'Check for updates'))]) + installNote());
    }
    const stash = stashInfo(), bdue = backupDue();
    const data = [
      setRow('sync', 'Where it is saved', `<span id="sync-line">${esc(syncText())}</span>`),
      setRow('backup', 'Backup', `Your whole progress as one small file, to keep safe or to move to another phone or a PC. <span id="bk-line"${bdue ? ' class="due"' : ''}>${backupLine()}${bdue ? ' This device holds the only copy of your progress.' : ''}</span>`, rowBtn('backup-save', 'Save', bdue ? 'gold' : '')),
      setRow('restore', 'Restore a backup', 'Continue from a backup file, or from its text.', rowBtn('backup-open', 'Restore')),
    ];
    if (stash) data.push(setRow('stash', 'Earlier copy on this device', 'Level ' + stash.state.level + ', last played ' + dateLabel(stash.state.lastDay) + '. It was replaced by ' + (stash.why === 'backup' ? 'a backup' : stash.why === 'swapped by hand' ? 'the copy you switched to' : 'your cloud save') + ' on ' + dateLabel(E.dayKey(new Date(stash.at))) + '.', rowBtn('stash-use', armed === 'stash' ? 'Confirm' : 'Use it', armed === 'stash' ? 'on' : '')));
    data.push(setRow('erase', 'Erase all progress', armed === 'reset' ? '<b>Tap again to erase everything.</b> This cannot be undone.' : 'Start over from the Awakening Test. This cannot be undone.', rowBtn('reset', armed === 'reset' ? 'Erase' : 'Erase all', 'danger')));
    const tools = [setRow('skip', 'Skip to tomorrow', 'Moves the game clock one day ahead. An unfinished quest is scored as it stands.', rowBtn('skip', 'Skip a day'))];
    if (testing()) tools.push(setRow('unskip', 'Back to today', plural(state.debugOffset, 'day') + ' skipped. Everything done while skipping is thrown away.', rowBtn('unskip', 'Go back')));
    return head('System', 'Settings')
      + sect('Hunter', `<div class="opts"><div class="opt col" data-key="s-name"><label class="o-main" for="in-name"><b>Hunter name</b></label><div class="addrow"><input class="field" id="in-name" maxlength="20" value="${esc(state.name)}" autocomplete="off" aria-label="Hunter name" enterkeyhint="done"><button class="btn" data-act="rename">Save</button></div></div></div>`)
      + sect('Training', group(training))
      + appPart
      + sect('Your progress', group(data))
      + sect('Testing', group(tools), 'For trying the prototype')
      + '<p class="note fine">Prototype 2, rules from the design doc of 26 Nov 2026. GPS and Apple Health runs, reminders and the full Hunter Hall belong to the iOS app.</p>';
  }

  function applySkin() {
    const skin = state && E.ITEMS.some(i => i.kind === 'theme' && i.id === state.theme) ? state.theme.replace('theme-', '') : '';
    if (skin) document.documentElement.dataset.skin = skin; else delete document.documentElement.dataset.skin;
  }
  // A red dot on a tab means something there is waiting for a decision.
  function tabDots() {
    const h = hunterDots();
    return { hunter: h.card || h.skills, system: E.retestDue(state) || backupDue() || !!(shell && shell.updateReady) };
  }
  const TABS = ['quest', 'hunter', 'log', 'hall', 'system'];
  const tabsIn = tabs && tabs.querySelector('.tabs-in');
  function render() {
    applySkin();
    if (!started) return;
    if (!state) { // a window that is open (restoring a backup) stays
      tabs.hidden = true; app.innerHTML = ''; miniHud(); watchHud();
      for (const k of Object.keys(shown)) delete shown[k]; // the next player's numbers start where they are, not counting from the last one's
      if (!modal) onboarding();
      return;
    }
    tabs.hidden = false;
    const dots = tabDots();
    document.querySelectorAll('.tab').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      b.classList.toggle('dot', !!dots[b.dataset.tab] && b.dataset.tab !== tab);
    });
    if (tabsIn) tabsIn.style.setProperty('--ti', String(Math.max(0, TABS.indexOf(tab))));
    const a = document.activeElement;
    const keep = a && app.contains(a) && a.dataset && a.dataset.act ? [a.dataset.act, a.dataset.id || '', a.dataset.n || '', a.dataset.kind || ''] : null;
    const body = tab === 'hunter' ? hunterScreen() : tab === 'log' ? logScreen() : tab === 'hall' ? hallScreen() : tab === 'system' ? systemScreen() : questScreen();
    app.dataset.tab = tab;
    morph(app, updateBar() + testBar() + `<div class="screen" data-key="scr-${tab}">${body}</div>`);
    if (keep && !app.contains(document.activeElement)) for (const el of app.querySelectorAll('[data-act="' + keep[0] + '"]')) {
      if ((el.dataset.id || '') === keep[1] && (el.dataset.n || '') === keep[2] && (el.dataset.kind || '') === keep[3] && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) {} break; }
    }
    runFx(app);
    miniHud();
    watchHud();
  }

  // ---------- moving between screens ----------
  // Each tab keeps its own scroll position. The new screen slides in from the side of its tab while the tab bar's
  // light glides across; the header and the bars stay put. Without view transitions the screen only fades in.
  const scrollMem = {};
  let vtRun = 0;
  function goTab(t) {
    if (!state || !TABS.includes(t)) return;
    armed = null;
    if (t === tab) { view.scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' }); return; } // the open tab again: back to the top
    scrollMem[tab] = view.scrollTop;
    const dir = TABS.indexOf(t) > TABS.indexOf(tab) ? 1 : -1;
    swapView(() => { tab = t; render(); view.scrollTop = scrollMem[t] || 0; }, dir);
  }
  function swapView(update, dir) {
    if (!calm.matches && typeof document.startViewTransition === 'function' && !document.hidden) {
      const n = ++vtRun;
      root.style.setProperty('--dir', String(dir));
      root.classList.add('vt');
      try {
        const vt = document.startViewTransition(update);
        vt.finished.finally(() => { if (n === vtRun) root.classList.remove('vt'); });
        return;
      } catch (e) { root.classList.remove('vt'); }
    }
    update();
    play(app.querySelector('.screen'), [{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: 'none' }], { duration: 340 });
  }
  // The small header shows once the top of the screen has scrolled up under the status bar: the level bar on the
  // quest screen, the title on the others.
  let hudEl = null, io = null;
  const setMini = on => root.classList.toggle('mini-on', !!on && !!state);
  function watchHud() {
    const h = state ? app.querySelector('.hud .xprow') || app.querySelector('.scr-head') : null;
    if (h === hudEl) return;
    if (io && hudEl) io.unobserve(hudEl);
    hudEl = h;
    if (!h) { setMini(false); return; }
    if (!io && 'IntersectionObserver' in window) {
      const top = Math.max(0, Math.round((parseFloat(getComputedStyle(app).paddingTop) || 12) - 6));
      io = new IntersectionObserver(es => { for (const e of es) if (e.target === hudEl) setMini(!e.isIntersecting); }, { root: view === root ? null : view, rootMargin: '-' + top + 'px 0px 0px 0px' });
    }
    if (io) io.observe(h);
  }
  // A card that opens near the bottom scrolls up far enough to show its buttons. Where it will end up is worked out
  // at once (its own growth, and any open card above it folding away), so the scroll runs alongside the unfolding.
  function reveal(card) {
    if (!card) return;
    requestAnimationFrame(() => {
      if (!card.isConnected) return;
      const h = el => el ? el.getBoundingClientRect().height : 0;
      const more = card.querySelector('.q-more'), grow = more && more.firstElementChild ? Math.max(0, more.firstElementChild.scrollHeight - h(more)) : 0;
      let shrink = 0;
      for (const c of card.parentElement.children) { if (c === card) break; if (!c.classList.contains('act')) shrink += h(c.querySelector('.q-more')); }
      const r = card.getBoundingClientRect(), top = r.top - shrink, bottom = r.bottom - shrink + grow;
      const floor = (tabs.hidden ? innerHeight : tabs.getBoundingClientRect().top) - 14, ceil = (parseFloat(getComputedStyle(app).paddingTop) || 12) + 58;
      const by = Math.min(bottom - floor, top - ceil);
      if (by > 4) view.scrollBy({ top: by, behavior: calm.matches ? 'auto' : 'smooth' });
    });
  }
  // The first look at the screen: the header, then each block, rise into place one after another.
  function intro() {
    if (calm.matches) return;
    const els = [...app.querySelectorAll('.screen > *')].slice(0, 7);
    els.forEach((el, i) => play(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 40 + i * 70, fill: 'backwards' }));
    play(tabs, [{ transform: 'translateY(105%)' }, { transform: 'none' }], { duration: 560, delay: 140, fill: 'backwards' });
  }

  // ---------- the keyboard and the visible area ----------
  // An iPhone moves the page while its keyboard is up, and can leave things out of place when the keyboard goes
  // (iOS 26 is known for leaving a bottom bar halfway up the screen). The page as a whole never scrolls here, so a
  // scroll left behind is put back, and the bars are pinned to what is really visible. While a field is being typed
  // in, the tab bar steps aside.
  const field = el => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit', 'range'].includes(el.type)));
  const touchy = window.matchMedia ? matchMedia('(hover: none) and (pointer: coarse)') : { matches: false };
  const vv = window.visualViewport;
  let typeT = 0;
  function pin() {
    if (!vv) return;
    const zoomed = vv.scale > 1.01, still = root.classList.contains('typing') || zoomed;
    const top = still ? 0 : Math.round(vv.offsetTop), gap = still ? 0 : Math.round(vv.offsetTop + vv.height - window.innerHeight);
    const kb = zoomed ? 0 : Math.round(window.innerHeight - vv.offsetTop - vv.height); // what the keyboard covers, so a message can sit just above it
    root.style.setProperty('--vv-top', (Math.abs(top) > 1 ? top : 0) + 'px');
    root.style.setProperty('--vv-gap', (Math.abs(gap) > 1 ? gap : 0) + 'px');
    root.style.setProperty('--kb', (kb > 1 ? kb : 0) + 'px');
  }
  function heal() {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (document.body.scrollTop) document.body.scrollTop = 0;
    pin();
    setTimeout(pin, 400); // the keyboard takes a moment to go
  }
  document.addEventListener('focusin', e => { if (field(e.target) && touchy.matches) { clearTimeout(typeT); root.classList.add('typing'); pin(); } });
  // The bars come back a moment after the field lets go, never in the middle of a tap: a press that starts on a button
  // must also end on it. An action that follows a tap ends the typing at once (dismiss, below).
  document.addEventListener('focusout', e => {
    if (!field(e.target) || field(e.relatedTarget)) return; // straight on to the next field: still typing
    clearTimeout(typeT);
    typeT = setTimeout(() => { if (!field(document.activeElement)) { root.classList.remove('typing'); heal(); } }, 120);
  });
  if (vv) { vv.addEventListener('resize', pin); vv.addEventListener('scroll', pin); }
  window.addEventListener('resize', pin);
  window.addEventListener('scroll', () => { if (!root.classList.contains('typing')) heal(); }, { passive: true });

  // ---------- onboarding and the Awakening Test ----------
  function testForm(p) {
    p = p || {};
    const f = (id, label, hint, mode) => `<label>${label}<span>${hint}</span><div class="tfield"><input class="field" id="t-${id}" inputmode="${mode}" placeholder="0" value="${p[id] ? esc(p[id]) : ''}" autocomplete="off"><span class="tier" id="tp-${id}">Tier 1</span></div></label>`;
    return f('pushups', 'Push-ups: the most in one set', 'Good form, no rest. Stop when the form breaks.', 'numeric')
      + `<label class="check"><input type="checkbox" id="t-knee" ${p.knee ? 'checked' : ''}><span>These were knee push-ups</span></label>`
      + f('situps', 'Sit-ups in 60 seconds', 'Count full reps.', 'numeric')
      + f('squats', 'Squats in 60 seconds', 'Bodyweight, thighs down to parallel.', 'numeric')
      + f('run12', 'Run: distance in 12 minutes, in km', 'Walking parts are fine. Leave it empty if you fill in the next one.', 'decimal')
      + f('runMax', 'Run: the longest you can go without stopping, in km', 'Optional. The better of the two run answers counts.', 'decimal')
      + '<div class="banner plain" id="t-preview" aria-live="polite"></div>';
  }
  const readNum = el => { const v = el ? parseFloat(String(el.value).replace(',', '.')) : 0; return isFinite(v) && v > 0 ? v : 0; };
  function readTest() {
    const n = id => readNum($('#t-' + id));
    return { pushups: n('pushups'), situps: n('situps'), squats: n('squats'), run12: n('run12'), runMax: n('runMax'), knee: !!($('#t-knee') && $('#t-knee').checked) };
  }
  function previewTest() {
    const box = $('#t-preview');
    if (!box) return;
    const t = readTest(), tiers = E.placeTest(t), tg = E.targetsFor(tiers);
    const chip = (id, tier) => { const el = $('#tp-' + id); if (el) el.textContent = 'Tier ' + tier; };
    chip('pushups', tiers.pushups); chip('situps', tiers.situps); chip('squats', tiers.squats);
    chip('run12', E.placeTest({ run12: t.run12 }).run); chip('runMax', E.placeTest({ runMax: t.runMax }).run);
    box.innerHTML = `<h3>Your quest</h3><p class="note"><b>${tg.pushups}</b> ${t.knee ? 'knee ' : ''}push-ups, <b>${tg.situps}</b> sit-ups, <b>${tg.squats}</b> squats and <b>${fmt('run', tg.run)} km</b> a day. Each task is placed on its own and grows from there.</p>`;
  }
  function onboarding() {
    const old = v1Save();
    const lead = old
      ? `<p>The System has been updated. Levels come faster, a rank now needs a Rank Trial, and stats grow only from real training. Your name, lifetime totals, XP, streak and history are kept.</p>
         <p class="note">One step is new: the Awakening Test, which places each exercise in one of six tiers.</p>`
      : `<p>Every day the System gives you one quest: push-ups, sit-ups, squats and a run. Clear it to earn XP, level up and climb from E rank to S rank. The goal is <b>100 / 100 / 100 / 5 km</b>. You start at your own level.</p>`;
    retire();
    modal = 'onboard';
    layer.innerHTML = `<div class="overlay k-onboard" role="dialog" aria-modal="true"><div class="win">
      <div class="gate aura-2"><div class="ka-art"><i class="ka-scene"></i>${figure(false)}<i class="ka-scrim"></i></div>
        <div class="ka-text"><div class="win-sub">${old ? 'System update.' : 'You have qualified as a Player.'}</div><h1 class="win-title">Daily Quest</h1></div>
      </div>
      ${lead}
      <div class="slot" id="ob-install">${installNote()}</div>
      <div class="form" id="testform">
        <label>Hunter name<input class="field" id="t-name" maxlength="20" placeholder="Player" autocomplete="off" value="${old ? esc(old.name || '') : ''}"></label>
        <div class="step-head"><h2 class="step">Awakening Test</h2><p class="note">Four short tests. Do them fresh, or enter honest recent numbers. You can re-test later.</p></div>
        ${testForm(old ? { pushups: old.test && old.test.pushups, runMax: old.test && old.test.run } : null)}
        ${banner('', 'Before you start', 'This is a training game, not medical advice. If you have a heart or joint condition, are coming back from an injury, or are not sure, check with a doctor first. Stop if you feel sharp pain, dizziness or chest tightness.', '', 'shield')}
        <button class="btn primary" data-act="begin">${old ? 'Continue the climb' : 'Accept the quest'}</button>
        <button class="btn ghost" data-act="backup-open">I have a backup to restore</button>
      </div>
    </div></div>`;
    previewTest();
  }
  function retestModal() {
    overlay('retest', `<div class="win-head">${ic('trial')}<div><h1 class="win-title small">Awakening Test</h1><div class="win-sub">What can you do today?</div></div></div>
      <div class="form" id="testform">${testForm(state.test)}
        <p class="note">A task that lands in the same tier keeps the weekly progress it has made. Level, XP, rank and titles are untouched.</p>
        <button class="btn primary" data-act="retest-save">Place my quest</button>
        <button class="btn ghost" data-act="close-modal">Cancel</button>
      </div>`);
    previewTest();
  }

  // ---------- tap mode and the plank timer ----------
  let tapId = null, tapCount = 0;
  function tapShare() { const day = E.today(state); return Math.min(100, (day.progress[tapId] + tapCount) / day.targets[tapId] * 100); }
  function tapMode(id) {
    retire();
    tapId = id; tapCount = 0; modal = 'tap';
    const day = E.today(state);
    layer.innerHTML = `<div class="tapzone" role="dialog" aria-modal="true">
      <div class="row"><span class="win-title small">${qname(id)}</span><span class="note">${fmt(id, day.progress[id])} / ${fmt(id, day.targets[id])} so far</span></div>
      <button class="tap-pad" data-act="tap-hit" aria-label="Count one rep">
        <span class="tap-ring" id="tap-ring" style="--p:${tapShare()}"><span class="tap-num" id="tap-num">0</span></span>
        <span class="note">Tap anywhere for each rep. For push-ups, put the phone under your chest and tap it with your nose.</span>
      </button>
      <div class="row"><button class="btn ghost" data-act="tap-cancel">Cancel</button><button class="btn primary grow" data-act="tap-done">Log reps</button></div>
    </div>`;
  }
  function tapHit() {
    tapCount++;
    const n = $('#tap-num'), ring = $('#tap-ring');
    if (n) n.textContent = tapCount;
    if (ring) {
      ring.style.setProperty('--p', tapShare());
      ring.classList.remove('hit'); void ring.offsetWidth; ring.classList.add('hit'); // replay the pulse
    }
    haptic('tap');
  }
  let plank = null, plankTimer = null, wake = null;
  const plankElapsed = () => plank ? plank.acc + (plank.since ? (Date.now() - plank.since) / 1000 : 0) : 0;
  function plankMode() {
    const p = E.today(state).penalty;
    if (!p || p.type !== 'plank') return;
    plank = { acc: 0, since: null, left: Math.max(0, p.need - p.done), rung: false };
    retire();
    modal = 'plank';
    layer.innerHTML = `<div class="tapzone warn" role="dialog" aria-modal="true">
      <div class="row"><span class="win-title small">Plank</span><span class="note">${mmss(p.done)} / ${mmss(p.need)} so far</span></div>
      <div class="tap-pad still"><span class="tap-ring" id="pl-ring" style="--p:0"><span class="tap-num" id="pl-num">0:00</span></span><span class="note" id="pl-note">${plank.left ? mmss(plank.left) + ' to go. Elbows under shoulders, body in one line.' : 'The penalty time is done. Anything more is yours.'}</span></div>
      <div class="row"><button class="btn ghost" data-act="pl-cancel">Cancel</button><button class="btn" data-act="pl-toggle" id="pl-toggle" data-focus>Start</button><button class="btn primary grow" data-act="pl-done">Log time</button></div>
    </div>`;
    plankTimer = setInterval(plankPaint, 250);
  }
  function plankPaint() {
    const num = $('#pl-num'), ring = $('#pl-ring');
    if (!num || !plank) return;
    const t = plankElapsed();
    num.textContent = mmss(t);
    if (ring) ring.style.setProperty('--p', plank.left ? Math.min(100, t / plank.left * 100) : 100);
    if (plank.left && t >= plank.left && !plank.rung) {
      plank.rung = true; haptic('ok');
      const n = $('#pl-note'); if (n) n.textContent = 'Time. The penalty is served. You can stop.';
      const zone = layer.querySelector('.tapzone'); if (zone) { zone.classList.remove('warn'); zone.classList.add('ok'); }
      burstAt(ring, { colors: [token('--okc'), '#ffffff'], n: 40, speed: 360 });
    }
  }
  function togglePlank() {
    if (!plank) return;
    if (plank.since) { plank.acc = plankElapsed(); plank.since = null; releaseWake(); }
    else {
      plank.since = Date.now();
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(w => { wake = w; }).catch(() => {}); } catch (e) {} // keep the screen on if the browser allows it
    }
    const b = $('#pl-toggle'); if (b) b.textContent = plank.since ? 'Pause' : 'Resume';
    plankPaint();
  }
  function releaseWake() { try { if (wake) wake.release().catch(() => {}); } catch (e) {} wake = null; }
  function stopPlank() { clearInterval(plankTimer); plankTimer = null; plank = null; releaseWake(); }

  // ---------- actions ----------
  // A task that is finished keeps its card open for a beat, so the stamp lands where the eye is,
  // and then the card folds away while the next unfinished one opens.
  let holdT = 0;
  function add(id, n, minutes) {
    if (!state) return;
    const wasOpen = openQuest(E.today(state)) === id;
    const ev = E.addProgress(state, id, n, { hour: now().getHours(), minutes });
    if (!ev.length) { toast('That could not be logged.', 'warn'); render(); return; } // a paused or rest day, or a save loaded from the cloud mid-count
    if (wasOpen && ev.some(e => e.type === 'task' && e.id === id)) {
      qsel = id;
      clearTimeout(holdT);
      holdT = setTimeout(() => { if (qsel !== id || !state) return; qsel = null; if (tab === 'quest') render(); }, calm.matches ? 300 : 1100);
    }
    save(); render(); handle(ev);
  }
  // On a phone the keyboard goes away once what was typed has been used.
  const dismiss = () => {
    const a = document.activeElement;
    if (touchy.matches && field(a)) a.blur();
    if (root.classList.contains('typing') && !field(document.activeElement)) { clearTimeout(typeT); root.classList.remove('typing'); heal(); } // the bars come back at once, ready for the XP that is about to land
  };
  // After an engine action that answers { ok, ev, why }.
  function done(res, msg, cls) {
    if (!res.ok) { toast(res.why || 'Not possible right now.', 'warn'); render(); nextModal(); return false; }
    save(); render();
    if (msg) toast(msg, cls || 'ok');
    handle(res.ev); nextModal();
    return true;
  }
  const ACTS = {
    sub(id) { sub = id; render(); },
    day(id) { logSel = id; render(); },
    pick(id) {
      clearTimeout(holdT);
      qsel = openQuest(E.today(state)) === id ? 'none' : id;
      render();
      if (qsel === id) reveal(app.querySelector('.quest[data-id="' + id + '"]'));
    },
    top() { view.scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' }); },
    fold(id) { openDetails[id] = !openDetails[id]; render(); },
    'chest-open'() { openChest(); },
    add(id, el) { haptic('tap'); floatUp(el, '+' + el.dataset.n); add(id, parseFloat(el.dataset.n)); },
    'add-custom'(id, el) {
      const inp = $('#in-' + id), v = readNum(inp);
      if (!(v > 0)) { if (inp) inp.focus(); toast('Enter a number first', 'warn'); return; }
      inp.value = '';
      dismiss(); haptic('tap');
      floatUp(el || $('#app [data-act="add-custom"][data-id="' + id + '"]'), '+' + fmt(id, v) + unit(id));
      if (id !== 'run') { add(id, v); return; }
      const min = $('#in-runmin'), m = readNum(min), pace = m > 0 ? m * 60 / v : 0;
      if (min) min.value = '';
      add('run', v, m > 0 ? m : undefined);
      if (m > 0 && v < 1) toast('Runs under 1 km do not count toward pace.', 'warn');
      else if (m > 0 && (pace < 150 || pace > 1500)) toast('That time does not look like a run, so only the distance was logged.', 'warn');
    },
    undo() {
      const u = E.undo(state);
      if (!u) return;
      save(); render();
      toast('Undid ' + (u.id === 'plank' ? mmss(u.amount) + ' of plank' : fmt(u.id, u.amount) + unit(u.id) + ' ' + qname(u.id).toLowerCase()) + (u.xp > 0 ? ' (-' + u.xp + ' XP)' : ''));
    },
    tap(id) { tapMode(id); },
    'tap-hit'() { tapHit(); },
    'tap-cancel'() { closeLayer(); nextModal(); },
    'tap-done'() { const n = tapCount, id = tapId; closeLayer(); if (n > 0) add(id, n); nextModal(); },
    'plank-add'(id, el) { add('plank', parseFloat(el.dataset.n)); },
    'plank-timer'() { plankMode(); },
    'pl-toggle'() { togglePlank(); },
    'pl-cancel'() { closeLayer(); nextModal(); },
    'pl-done'() { const sec = Math.round(plankElapsed()); closeLayer(); if (sec > 0) add('plank', sec); nextModal(); },
    'close-modal'() { closeLayer(); nextModal(); },
    begin() {
      const name = ($('#t-name') || {}).value || '', test = readTest(), old = v1Save();
      const seed = Math.floor(Math.random() * 2147483000) + 1;
      state = old ? E.migrateV1(old, name, test, todayKey(), seed) : E.newPlayer(name, test, todayKey(), seed);
      qsel = null;
      if (old) store.set(V1KEY + '.done', '1');
      closeLayer(); tab = 'quest'; save(); render(); view.scrollTop = 0; intro();
      toast(old ? 'Progress carried over. Welcome back.' : 'Title unlocked: The Awakened', 'gold');
    },
    retest() { retestModal(); },
    'retest-save'() {
      const res = E.retest(state, readTest());
      closeLayer(); tab = 'quest';
      done(res, 'Quest ' + (res.today ? 'today' : 'from tomorrow') + ': ' + quest4(res.targets));
    },
    title(id) { done(E.setTitle(state, id)); },
    aura(id) { done(E.setAura(state, id === 'auto' ? null : Number(id))); },
    'skill-on'(id) { done(E.equipSkill(state, id), 'Skill equipped'); },
    'skill-off'(id) { done(E.unequipSkill(state, id), 'Skill removed'); },
    buy(id, el, was) {
      if (was !== 'buy:' + id) { armed = 'buy:' + id; render(); return; }
      const it = E.ITEMS.find(x => x.id === id), res = E.buyItem(state, id);
      if (res.ok) E.equipItem(state, it.kind, id);
      done(res, it.name + ' bought and equipped', 'gold');
    },
    equip(id, el) { done(E.equipItem(state, el.dataset.kind, id || null)); },
    trial() { trialModal(); },
    'trial-go'() { closeLayer(); done(E.startTrial(state), 'Rank Trial started', 'gold'); },
    rest() { restModal(); },
    'rest-go'() { closeLayer(); done(E.useRestToken(state), 'Rest day. The streak is frozen.'); },
    'rest-cancel'() { done(E.cancelRest(state), 'Rest cancelled. The token is back.'); },
    overdrive() { done(E.activateOverdrive(state), 'Overdrive is active today', 'gold'); },
    focus(id) { done(E.setFocus(state, E.today(state).focus === id ? null : id)); },
    felt(id) {
      if (!E.setFelt(state, id).ok) return;
      openDetails.felt = false;
      save(); render();
      layer.querySelectorAll('[data-act="felt"]').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    },
    'hard-on'() { hardModal(); },
    'hard-go'() { closeLayer(); done(E.setHard(state, true), 'Hard mode is on', 'warn'); },
    'hard-off'() { const res = E.setHard(state, false); done(res, res.pending ? 'Hard mode ends when this streak does' : 'Hard mode is off'); },
    'hard-keep'() { done(E.setHard(state, true), 'Hard mode stays on'); },
    'pause-on'() { done(E.setPaused(state, true), 'Paused. Recover first.'); },
    'pause-off'() { done(E.setPaused(state, false), 'The quest is live again.'); },
    rename() {
      const inp = $('#in-name'), v = ((inp || {}).value || '').trim();
      if (!v) return;
      dismiss();
      done(E.rename(state, v), 'Name saved');
    },
    skip() {
      if (!state.debugOffset) { pretestMem = JSON.stringify(state); store.set(PRETEST, pretestMem); } // the real progress, kept aside
      state.debugOffset = (state.debugOffset || 0) + 1;
      tab = 'quest';
      const ev = E.ensureDay(state, todayKey());
      writeLocal(); render(); view.scrollTop = 0; handle(ev);
    },
    unskip() {
      let back = null;
      try { back = JSON.parse(store.get(PRETEST) || pretestMem || 'null'); } catch (e) {}
      if (valid(back)) state = back;
      delete state.debugOffset;
      store.del(PRETEST); pretestMem = null; queue = []; closeLayer();
      const ev = E.ensureDay(state, todayKey());
      save(); reconcile(); // the cloud copy may have moved on meanwhile
      render(); toast('Back to today. The test days are gone.', 'ok'); handle(ev);
    },
    'stash-use'(id, el, was) {
      if (was !== 'stash') { armed = 'stash'; render(); return; }
      const info = stashInfo();
      if (!info) { render(); return; }
      const cur = state, back = info.state;
      delete back.debugOffset;
      if (cur.sid !== back.sid) { meta.dead = meta.dead.filter(x => x !== back.sid).concat(cur.sid).slice(-30); saveMeta(); } // this player replaces the other one everywhere
      back.rev = Math.max(back.rev || 0, cur.rev || 0, (cloud.snap && cloud.snap.rev) || 0);
      store.set(STASH, JSON.stringify({ at: Date.now(), why: 'swapped by hand', json: JSON.stringify(cur) })); // so the swap can be undone the same way
      state = back; queue = []; closeLayer();
      const ev = E.ensureDay(state, todayKey());
      save(); render(); toast('The earlier copy is back.', 'ok'); handle(ev);
    },
    reset(id, el, was) {
      if (was !== 'reset') { armed = 'reset'; render(); return; }
      meta.dead = meta.dead.concat(state.sid).slice(-30); delete meta.backupAt; saveMeta();
      state = null; queue = []; pretestMem = null; logSel = null; qsel = null; tab = 'quest'; sub = 'card';
      store.del(KEY); store.del(PRETEST); store.del(STASH); store.del(V1KEY); store.del(V1KEY + '.done');
      cloudDirty(true);
      closeLayer(); render();
    },
    // ----- backup -----
    async 'backup-save'() {
      if (testing()) { toast('Go back to today first. The test clock is running.', 'warn'); return; }
      const text = backupText();
      const how = await saveFile('ascend-backup-' + E.dayKey(new Date()) + '.json', text);
      if (how === 'cancelled') return;
      if (how === 'failed') { if (!modal) backupTextModal(text); return; }
      backedUp(); render();
      toast(how === 'shared' ? 'Backup handed over. Keep it somewhere safe.' : 'Backup saved to your downloads.', 'ok', ic('shield'));
    },
    async 'backup-copy'() {
      const box = $('#bk-out');
      if (!box) return;
      if (await copyText(box.value)) { backedUp(); render(); toast('Copied. Paste it somewhere safe.', 'ok', ic('shield')); }
      else { try { box.focus(); box.select(); } catch (e) {} toast('Copying is blocked here. Copy the selected text by hand.', 'warn'); }
    },
    'backup-open'() {
      if (testing()) { toast('Go back to today first. The test clock is running.', 'warn'); return; }
      restoreModal();
    },
    'backup-pick'() { const f = $('#bk-file'); if (f) f.click(); },
    'backup-read'() {
      const box = $('#bk-text'), text = ((box || {}).value || '').trim();
      if (!text) { backupError('Paste the backup text first, or choose the file.'); if (box) box.focus(); return; }
      tryBackup(text);
    },
    'backup-cancel'() { pending = null; closeLayer(); if (state) nextModal(); else render(); },
    'backup-apply'() {
      const p = pending, cur = state;
      pending = null;
      if (!p || testing()) { closeLayer(); render(); return; }
      const back = p.state;
      if (cur) store.set(STASH, JSON.stringify({ at: Date.now(), why: 'backup', json: JSON.stringify(cur) })); // the copy that is replaced stays recoverable
      // A player that was erased on this account comes back under a new id, or another device would erase it again.
      if (meta.dead.includes(back.sid)) back.sid = 'p' + (Math.floor(Math.random() * 2147483000) + 1).toString(36) + 'r';
      if (cur && cur.sid !== back.sid) meta.dead = meta.dead.concat(cur.sid).slice(-30); // this player replaces the other one everywhere
      back.rev = Math.max(back.rev || 0, (cur && cur.rev) || 0, (cloud.snap && cloud.snap.rev) || 0);
      meta.backupAt = Date.now(); // the file that was just read is as fresh as the progress
      saveMeta();
      state = back; queue = []; logSel = null; qsel = null; tab = 'quest'; sub = 'card';
      closeLayer();
      const ev = E.ensureDay(state, todayKey());
      save(); render(); view.scrollTop = 0; intro();
      toast('Backup restored.', 'ok', ic('shield')); handle(ev);
    },
    // ----- the installable web app -----
    'app-update'() { if (shell) { toast('Updating.', 'ok'); shell.update(); } },
    async 'app-check'(id, el) {
      if (!shell) return;
      if (el) { el.disabled = true; el.textContent = 'Checking'; }
      const res = await shell.check();
      render();
      if (res === 'ready') toast('A new version is ready.', 'ok', ic('star'));
      else if (res === 'current') toast('You have the latest version.', 'ok', ic('clear'));
      else if (res === 'offline') toast('No connection. Try again when you are online.', 'warn');
      else toast('This browser keeps no copy of the app, so it always loads the latest version.');
    },
    async 'app-install'() {
      if (shell && await shell.install()) toast('Installed. Open Ascend from its icon.', 'ok', ic('star'));
    },
  };
  // What can be done before there is a save: starting, and restoring a backup.
  const FREE = new Set(['begin', 'backup-open', 'backup-pick', 'backup-read', 'backup-cancel', 'backup-apply', 'app-install']);

  document.addEventListener('click', e => {
    const tb = e.target.closest('.tab');
    if (tb) { goTab(tb.dataset.tab); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el !== document.activeElement && el.dataset.act !== 'add-custom' && el.dataset.act !== 'rename') dismiss(); // a tap elsewhere ends the typing
    const was = armed, fn = ACTS[el.dataset.act];
    armed = null;
    if (fn && (state || FREE.has(el.dataset.act))) fn(el.dataset.id, el, was);
  });
  document.addEventListener('change', async e => { // a backup file was picked
    const inp = e.target;
    if (!inp || inp.id !== 'bk-file') return;
    const file = inp.files && inp.files[0];
    if (!file) return;
    let text = null;
    if (file.size <= BACKUP.maxBytes) try { text = await fileText(file); } catch (err) {}
    try { inp.value = ''; } catch (err) {} // the same file can be picked again
    if (modal !== 'restore') return;
    if (text == null) backupError(file.size > BACKUP.maxBytes ? 'That file is too large to be a backup.' : 'That file could not be read.');
    else tryBackup(text);
  });
  document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#testform')) previewTest(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal !== 'onboard') {
      const b = layer.querySelector('[data-act="close-modal"], [data-act="tap-cancel"], [data-act="pl-cancel"], [data-act="backup-cancel"]');
      if (b) b.click();
      return;
    }
    if (e.key !== 'Enter' || !state) return;
    const id = e.target.id || '';
    if (id === 'in-name') ACTS.rename();
    else if (id === 'in-runmin') ACTS['add-custom']('run');
    else if (id.startsWith('in-')) ACTS['add-custom'](id.slice(3));
  });

  // The 4 AM reset: checked when the page comes back to the front and on a timer.
  function tick() {
    if (!started || !state) return;
    const ev = E.ensureDay(state, todayKey());
    if (ev.length) { save(); render(); handle(ev); }
    else if (shellLate && !typing()) { shellLate = false; render(); }
    else { const cd = $('#cd'); if (cd) cd.textContent = countdown(); }
  }
  // The shell reports a new version, an install, or a change of window. The screen follows, but never under someone's typing.
  let shellLate = false;
  const typing = () => { const a = document.activeElement; return !!a && app.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName); };
  if (shell) shell.onChange(() => {
    if (!started) return;
    const slot = $('#ob-install');
    if (slot) slot.innerHTML = installNote();
    if (!state) return;
    if (typing()) shellLate = true; else render();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
    else if (cloud.dirty) { clearTimeout(cloud.timer); push(); } // leaving: send what is waiting
  });
  setInterval(tick, 20000);

  // ---------- start ----------
  function start() {
    if (started) return;
    started = true;
    closeLayer();
    if (state) {
      const ev = E.ensureDay(state, todayKey());
      if (ev.length) save();
      render(); intro(); handle(ev);
    } else render();
  }
  meta = store.json(META);
  if (!meta || typeof meta.device !== 'string' || !Array.isArray(meta.dead)) { meta = { device: 'd' + Math.random().toString(36).slice(2, 10), dead: [] }; saveMeta(); }
  me = meta.device + '.' + Math.random().toString(36).slice(2, 6);
  const local = store.json(KEY);
  state = valid(local) ? local : null;
  applySkin();
  if (cloud.api) connectCloud();
  // On the first visit of a day, or with nothing saved here, give the cloud copy a moment before the day is scored.
  if (cloud.api && !testing() && (!state || state.lastDay !== todayKey())) {
    modal = 'splash';
    layer.innerHTML = '<div class="overlay k-splash"><div class="win center"><div class="label">System</div><div class="spinner"></div><h2 class="big-word mid">SYNCING</h2><p class="note">Looking for your saved progress.</p></div></div>';
    Promise.race([settled, new Promise(res => setTimeout(res, 3500))]).then(start);
  } else start();
  // The opened chest first shows in the middle of a reveal, so it is fetched ahead of time.
  setTimeout(() => { new Image().src = A + 'chest-open.webp'; }, 2500);
})();
