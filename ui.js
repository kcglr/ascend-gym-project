// ---------- UI layer (browser only). On iOS this part is rewritten; the Engine above is reused as it is. ----------
(() => {
  const E = Engine, T = E.TUNING;
  const KEY = 'dailyquest.v2', META = KEY + '.meta', PRETEST = KEY + '.pretest', STASH = KEY + '.stash', V1KEY = 'dailyquest.v1';
  const $ = s => document.querySelector(s);
  const app = $('#app'), layer = $('#layer'), toasts = $('#toasts'), tabs = $('#tabs');
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
    return valid(st) ? { at: s.at, state: st } : null;
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
      default: return storageOk ? 'Progress is saved in this browser on this device only.' : 'This browser is blocking storage, so progress will be lost when you close the page.';
    }
  }
  function syncUI() { const el = $('#sync-line'); if (el) el.textContent = syncText(); }


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
  // The screen is redrawn after every tap, so a bar or a number would jump to its new value. These helpers
  // remember what was shown last: a bar starts from its old width, and a number that changed gets a bump.
  const calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const shown = {};
  function moved(key, to, prop) {
    const from = shown[key];
    shown[key] = to;
    return (prop ? 'data-prop="' + prop + '" ' : '') + (from != null && from !== to ? 'data-from="' + from + '" data-to="' + to + '" ' : '');
  }
  const fill = (key, share) => { const w = Math.round(Math.max(0, Math.min(1, share)) * 1000) / 10 + '%'; return `<i ${moved(key, w)}style="width:${w}"></i>`; };
  const changed = (key, value) => { const was = shown[key]; shown[key] = value; return was != null && was !== value; };
  function settleMotion(root) {
    const els = root.querySelectorAll('[data-from]');
    if (!els.length) return;
    for (const el of els) { el.style.transition = 'none'; el.style.setProperty(el.dataset.prop || 'width', el.dataset.from); }
    void root.offsetWidth;
    for (const el of els) { el.style.transition = ''; el.style.setProperty(el.dataset.prop || 'width', el.dataset.to); }
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

  // Sparks: one canvas above everything, drawn only while something is flying.
  const fxc = $('#fx'), fx2d = fxc && fxc.getContext ? fxc.getContext('2d') : null;
  let sparks = [], fxOn = false, fxLast = 0;
  const token = name => 'rgb(' + (getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(',') || '255,255,255') + ')';
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
  let xpToast = null;
  function xpGain(n) { // quick taps add up in one toast instead of stacking
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
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

  // ---------- events from the engine ----------
  function handle(events) {
    if (!events || !events.length) return;
    const levels = [];
    for (const e of events) {
      if (e.type === 'xp') { if (e.amount > 0) xpGain(e.amount); }
      else if (e.type === 'task') {
        toast(e.name + ' complete', 'ok', ic('clear')); buzz(40);
        burstAt($('#app .quest[data-id="' + e.id + '"] .q-med'), { colors: [token('--okc'), '#ffffff', token('--g')], n: 30, speed: 300 });
      }
      else if (e.type === 'penaltyCleared') toast('Penalty served. The streak carries on.', 'ok', ic('shield'));
      else if (e.type === 'stat') toast(STAT[e.stat] + ' +' + e.gain + ' (now ' + e.value + ')', '', ic(e.stat.toLowerCase()));
      else if (e.type === 'title') toast('Title unlocked: ' + e.name, 'gold', ic('star'));
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
  }
  // A system window over the page. `cls` may carry a colour mood: "gold" or "warnwin".
  function overlay(kind, inner, cls) {
    modal = kind;
    cls = cls || '';
    const mood = /\bgold\b/.test(cls) ? ' gold' : /\bwarnwin\b/.test(cls) ? ' warnwin' : '';
    layer.innerHTML = `<div class="overlay k-${kind}${mood}" role="dialog" aria-modal="true"><div class="win ${cls}"><i class="orn t"></i><i class="orn b"></i>${inner}</div></div>`;
    const f = layer.querySelector('[data-focus]');
    if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function closeLayer() { stopPlank(); modal = null; layer.innerHTML = ''; }
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
    if (r.broke) buzz([200, 80, 200]);
  }

  // The clear screen: the chest waits to be opened, then the rewards are counted out.
  function clearModal(e) {
    const day = E.today(state), live = E.liveStreak(state);
    const item = e.chest.item ? E.ITEMS.find(x => x.id === e.chest.item) : null;
    const rows = xpRows(E.breakdown(state, day), day);
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
        <p class="note">${e.full ? 'That was the full routine: 100 / 100 / 100 / 5 km. This is the limit. Hold it.' : 'Your answer steers the quest. Clear 5 days out of 7 and it grows by about 10%, unless it felt too hard twice that week.'}</p>
        <button class="btn primary wide" data-act="close-modal">Claim</button>
      </div>`, 'center clearwin');
    buzz([60, 40, 120]);
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
    buzz([30, 30, 90]);
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
    buzz([80, 50, 80, 50, 200]);
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
    buzz([120, 60, 120, 60, 300]);
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

  // ---------- screens ----------
  const myCrest = cls => crest(state.rank, E.auraOf(state), (cls || '') + (state.hard ? ' hard' : ''), state.rank >= 4);
  const noticeIcon = cls => /\bwarn\b/.test(cls) ? 'skull' : /\bok\b/.test(cls) ? 'clear' : /\bgold\b/.test(cls) ? 'trial' : 'system';
  const banner = (cls, title, text, extra, icon) => `<div class="banner ${cls}">${ic(icon || noticeIcon(cls))}<div class="b-main"><h3>${title}</h3><p class="note">${text}</p>${extra || ''}</div></div>`;
  const opt = (title, text, act, label, cls, icon) => `<div class="opt ${cls || ''}">${icon || ''}<span class="o-main"><b>${title}</b><small>${text}</small></span>${act ? `<button class="btn small" data-act="${act}">${label}</button>` : label ? `<span class="tag dim">${label}</span>` : ''}</div>`;
  const head = (icon, title, sub, chip) => `<header class="scr-head"><span class="sh-ic">${ic(icon)}</span><div class="sh-text"><h1 class="win-title">${title}</h1><div class="win-sub">${sub}</div></div>${chip || ''}</header>`;
  const panel = (label, body, cls) => `<section class="panel ${cls || ''}">${label ? `<div class="ph">${label}</div>` : ''}${body}</section>`;

  function testBar() {
    return testing() ? `<div class="testbar"><span>Test clock <b>+${plural(state.debugOffset, 'day')}</b>. Nothing done here is kept.</span><button class="btn small" data-act="unskip">Back to today</button></div>` : '';
  }
  function hud() {
    const need = E.xpForNext(state.level), max = !isFinite(need), live = E.liveStreak(state);
    const t = E.TITLES.find(x => x.id === state.title);
    return `<header class="hud">
      <div class="hud-crest">${myCrest()}</div>
      <div class="hud-main">
        <div class="hud-top"><span class="pname">${esc(state.name)}</span><span class="pills">
          <span class="pill" role="img" aria-label="${state.essence} Essence">${ob('essence')}${num(state.essence)}</span>
          <span class="pill ${live.n ? 'hot' : ''}" role="img" aria-label="Streak ${live.n}">${ob('flame')}${live.n}</span>
        </span></div>
        <div class="ptitle"><span>${t ? esc(t.name) : 'No title'}</span>${state.hard ? '<span class="tag-hard">HARD MODE</span>' : ''}</div>
        <div class="xprow"><span class="plevel">LV ${state.level}</span><div class="bar xp">${fill('xp', max ? 1 : state.xp / need)}<span class="xpnum">${max ? 'MAX LEVEL' : num(state.xp) + ' / ' + num(need) + ' XP'}</span></div></div>
      </div>
    </header>`;
  }
  function countdown() {
    const n = now(), m = Math.max(0, Math.round((E.nextReset(n) - n) / 60000));
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }

  // One quest row is open at a time. null follows the first unfinished task, 'none' closes them all.
  let qsel = null, qselDay = null;
  const openQuest = day => {
    if (qselDay !== state.lastDay) { qsel = null; qselDay = state.lastDay; } // the choice belongs to one day
    return qsel === 'none' ? null : E.QUEST_IDS.includes(qsel) ? qsel : (E.QUESTS.find(q => day.progress[q.id] < day.targets[q.id]) || {}).id || null;
  };
  const stamp = key => `<span class="stamp${changed(key, true) ? ' pop' : ''}">${ic('clear')}Clear</span>`;

  function questScreen() {
    const day = E.today(state), live = E.liveStreak(state);
    const resting = day.kind === 'rest', paused = !!day.paused, logOn = E.canLog(state);
    const pen = day.penalty, penDone = E.penaltyDone(day);
    const title = resting ? 'Rest Day' : paused ? 'Quest Paused' : pen ? 'Penalty Quest' : 'Daily Quest';
    const mood = resting ? 'rest' : paused ? 'paused' : pen && !penDone && logOn ? 'pen warnwin' : day.cleared ? 'cleared' : '';
    let out = `<section class="keyart aura-${E.auraOf(state)} ${mood}">
      <div class="ka-art"><i class="ka-scene"></i>${figure(state.rank >= 4)}<i class="ka-scrim"></i></div>
      <span class="chip ${live.n ? 'hot' : ''}">${ob('flame')}Streak ${live.n}</span>
      <div class="ka-text"><h1 class="win-title">${title}</h1><div class="win-sub">${ic('time')}<span>Next quest at 4 AM, in <span id="cd">${countdown()}</span>.</span></div></div>
    </section>`;

    if (resting) out += banner('gold', 'Rest day', 'A rest token is holding your streak. No XP today and no penalty tomorrow.', '<button class="btn small" data-act="rest-cancel">Train after all</button>', 'rest');
    else if (paused) out += banner('', 'Injured or sick mode', 'The quest and the streak are paused. Nothing is lost while you recover.', '<button class="btn small" data-act="pause-off">I am ready to train</button>', 'shield');
    else {
      if (state.paused) out += banner('', 'Pause starts tomorrow', 'Today was already cleared, so it counts. From tomorrow the quest and the streak are paused.', '<button class="btn small" data-act="pause-off">Cancel the pause</button>', 'shield');
      if (pen) out += penDone
        ? banner('ok', 'Penalty served', 'Quest and extra task are done. The streak carries on.')
        : banner('warn', 'Penalty Quest', 'Clear the quest and the extra task today (' + penaltyText(pen) + '), or the streak resets to 0.' + (state.hard ? ' Hard mode doubled the extra task.' : ''));
      if (day.trial) out += day.trial.passed
        ? banner('gold', 'Rank Trial passed', 'You hold ' + E.RANKS[day.trial.rank].id + ' rank.')
        : banner('gold', 'Rank Trial: ' + E.RANKS[day.trial.rank].id + ' rank', 'Reach ' + quest4(day.trial.req) + ' before the reset. Everything you log today counts. Not passing costs nothing.');
      if (day.cleared) out += banner('ok', 'Quest cleared', 'Rest, or keep going: extra work still earns XP. How did it feel?', feltButtons(day));
    }

    if (logOn) {
      const sc = E.score(day);
      const hint = live.state === 'risk' ? 'Finish all four tasks and the extra task to save the streak.'
        : live.state === 'grown' ? (day.cleared ? 'Today counts toward the streak.' : 'Past 75%: today counts toward the streak. Clear all four for the bonus and the chest.')
        : live.state === 'hold' ? 'The streak holds. Reach 75% to grow it.'
        : state.graceDay === state.lastDay ? 'You awakened today, so nothing is owed if you start tomorrow. After today, a day under 25% brings a Penalty Quest.'
        : sc > 0 ? 'Under 25% means a Penalty Quest tomorrow.' : 'Nothing logged yet. A missed day means a Penalty Quest tomorrow.';
      // The score bar is a reward track: no penalty at 25%, the streak grows at 75%, the chest waits at the end.
      const node = (key, at, icon, text) => { const lit = sc >= at; return `<span class="tk-node${lit ? ' lit' : ''}${changed(key, lit) && lit ? ' pop' : ''}" style="left:${at * 100}%"><b>${icon}</b><small>${text}</small></span>`; };
      out += `<section class="panel track${day.cleared ? ' cleared' : ''}${pen && !penDone ? ' warn' : ''}">
        <div class="tk-row">
          <div class="tk-main">
            <div class="row"><span class="ph">Quest score</span><span class="tk-pct">${pct(sc)}</span></div>
            <div class="tk-bar${pen ? ' bare' : ''}">
              <div class="bar tall seg ${day.cleared ? 'ok' : ''}">${fill('score', sc)}</div>
              ${pen ? '' : node('n1', T.partial, ic('shield'), 'No penalty') + node('n2', T.nearClear, ob('flame'), 'Streak +1')}
            </div>
          </div>
          <span class="tk-chest${day.cleared ? ' lit' : ''}">${ob(day.cleared ? 'chest-open' : 'chest-closed')}<small>${day.cleared ? 'Claimed' : 'Chest'}</small></span>
        </div>
        <p class="note" id="q-hint">${hint}</p>
      </section>`;

      const focusOn = state.skills.includes('splitFocus'), open = openQuest(day);
      const rows = E.QUESTS.map(q => {
        const id = q.id, p = day.progress[id], t = day.targets[id], done = p >= t, isRun = id === 'run', share = Math.min(1, p / t);
        const shownCount = fmt(id, p);
        const top = `<span class="q-med" ${moved('m-' + id, String(Math.round(share * 1000) / 10), '--p')}style="--p:${Math.round(share * 1000) / 10}">${ic(id)}</span>
          <span class="q-body">
            <span class="q-top"><span class="q-name">${q.name}${id === 'pushups' && state.test.knee ? ' (knee)' : ''}</span><span class="q-count${changed('c-' + id, shownCount) ? ' bump' : ''}">${shownCount}<small> / ${fmt(id, t)}${unit(id)}</small></span></span>
            <span class="bar seg ${done ? 'ok' : ''}">${fill('q-' + id, share)}</span>
          </span>${done ? stamp('s-' + id) : (changed('s-' + id, false), '')}`;
        if (id !== open) return `<button class="quest ${done ? 'done' : ''}" data-act="pick" data-id="${id}" aria-expanded="false">${top}</button>`;

        const cap = isRun ? r2(t * (1 + T.overflowCap)) : Math.floor(t * (1 + T.overflowCap) + 1e-9);
        const notes = [];
        if (day.trial && !day.trial.passed && p < day.trial.req[id]) notes.push('Trial: ' + fmt(id, day.trial.req[id]) + unit(id) + ' needed, ' + fmt(id, r2(day.trial.req[id] - p)) + unit(id) + ' to go.');
        if (pen && pen.type === 'extra' && pen.id === id) notes.push(p >= pen.need ? 'Penalty extra done.' : 'Penalty: ' + fmt(id, pen.need) + unit(id) + ' today, ' + fmt(id, r2(pen.need - p)) + unit(id) + ' to go.');
        if (isRun && !done && day.tiers.run <= 2) notes.push('Walk-run intervals count at this tier. Cover the distance.');
        if (isRun) notes.push('Add the minutes for a run of 1 km or more and it counts toward your pace and Agility.');
        if (done) notes.push(p < cap ? 'Extra work up to ' + fmt(id, cap) + unit(id) + ' earns bonus XP at ' + (day.overdrive ? 'full rate (Overdrive).' : 'half rate.') : 'Bonus XP is maxed for today.');
        const btns = isRun
          ? `<button class="btn grow" data-act="add" data-id="run" data-n="0.5">+0.5</button>
             <button class="btn grow" data-act="add" data-id="run" data-n="1">+1</button>
             <div class="addrow full">
               <input class="field" id="in-run" inputmode="decimal" placeholder="km" aria-label="Run distance in km">
               <input class="field" id="in-runmin" inputmode="decimal" placeholder="min" aria-label="Run time in minutes, optional">
               <button class="btn" data-act="add-custom" data-id="run">Add</button>
             </div>`
          : `<button class="btn grow" data-act="add" data-id="${id}" data-n="1">+1</button>
             <button class="btn grow" data-act="add" data-id="${id}" data-n="5">+5</button>
             <button class="btn grow" data-act="add" data-id="${id}" data-n="10">+10</button>
             <button class="btn grow tapbtn" data-act="tap" data-id="${id}">Tap</button>
             <div class="addrow full">
               <input class="field" id="in-${id}" inputmode="numeric" placeholder="reps" aria-label="${q.name} amount">
               <button class="btn" data-act="add-custom" data-id="${id}">Add</button>
             </div>`;
        return `<div class="quest act ${done ? 'done' : ''}" data-id="${id}">
          <button class="q-head" data-act="pick" data-id="${id}" aria-expanded="true">${top}</button>
          <div class="q-tags"><span class="q-stat">${q.stat}</span><span class="tier">Tier ${day.tiers[id]} &middot; XP x${E.multOf(day.tiers[id])}</span>${focusOn ? `<button class="chiplet ${day.focus === id ? 'on' : ''}" data-act="focus" data-id="${id}">Focus x2</button>` : ''}</div>
          <div class="q-btns">${btns}</div>
          ${notes.map(n => `<p class="note">${n}</p>`).join('')}
        </div>`;
      }).join('');

      let plankRow = '';
      if (pen && pen.type === 'plank') {
        const pd = pen.done >= pen.need, share = Math.min(1, pen.done / pen.need);
        plankRow = `<div class="quest pen act ${pd ? 'done' : 'warn'}">
          <div class="q-head">
            <span class="q-med" style="--p:${Math.round(share * 100)}">${ic('time')}</span>
            <span class="q-body">
              <span class="q-top"><span class="q-name">Plank</span><span class="q-count">${mmss(pen.done)}<small> / ${mmss(pen.need)}</small></span></span>
              <span class="bar seg ${pd ? 'ok' : ''}">${fill('q-plank', share)}</span>
            </span>${pd ? stamp('s-plank') : (changed('s-plank', false), '')}
          </div>
          <div class="q-tags"><span class="q-stat">Penalty</span></div>
          <div class="q-btns">
            <button class="btn grow" data-act="plank-timer">Timer</button>
            <button class="btn grow" data-act="plank-add" data-n="30">+30 s</button>
            <button class="btn grow" data-act="plank-add" data-n="60">+1 min</button>
          </div>
          ${pd ? '' : '<p class="note">Total time counts. It does not have to be one hold.</p>'}
        </div>`;
      }
      out += `<div class="quests">${rows}${plankRow}</div>
        <div class="row foot">
          <span class="note">Earned today: <b>${Math.round(Number(day.xp) || 0)} XP</b></span>
          <button class="btn ghost small" data-act="undo" ${day.log && day.log.length ? '' : 'disabled'}>Undo last</button>
        </div>
        <details class="more" data-keep="xp" ${openDetails.xp ? 'open' : ''}><summary>How today's XP adds up</summary><div class="rewards">${rewardRows(xpRows(E.breakdown(state, day), day))}</div></details>`;
    } else if (!resting) out += `<p class="note">Today's quest stays at ${quest4(day.targets)}. It will be waiting when you are back.</p>`;

    // today's choices
    const opts = [];
    const tri = E.trialInfo(state);
    if (tri.next && !day.trial) {
      const need = quest4(tri.next.trial), ri = E.RANKS.indexOf(tri.next), next = crest(ri, ri, 'mini' + (tri.canStart ? '' : ' sealed'));
      if (tri.canStart) opts.push(opt('Rank Trial: ' + tri.next.id + ' rank', need + ' in one day. What you logged today counts.', 'trial', 'Start', 'gold', next));
      else if (tri.levelOk && tri.wait) opts.push(opt('Rank Trial: ' + tri.next.id + ' rank', 'Not passed last time. Open again in ' + plural(tri.wait, 'day') + '.', null, 'Wait', '', next));
      else if (tri.levelOk) opts.push(opt('Rank Trial: ' + tri.next.id + ' rank', 'Open on your next training day.', null, 'Ready', '', next));
      else opts.push(opt('Next rank: ' + tri.next.id, 'Level ' + tri.next.level + ' and a one-day Rank Trial: ' + need + '.', null, 'Lv ' + state.level + ' / ' + tri.next.level, '', next));
    }
    const rest = E.restInfo(state);
    if (!rest.resting) {
      const full = rest.tokens >= rest.cap;
      const text = rest.canUse ? 'Freeze the streak today: no XP and no penalty.'
        : rest.tokens ? rest.why
        : 'Earned by ' + rest.every + ' full clears in a row. So far: ' + rest.run + '.';
      opts.push(opt('Rest token ' + rest.tokens + ' / ' + rest.cap, text + (full && !rest.canUse ? ' The pouch is full.' : ''), rest.canUse ? 'rest' : null, rest.canUse ? 'Rest today' : rest.tokens ? 'Held' : rest.run + ' / ' + rest.every, '', ob('token', rest.tokens ? '' : 'faded')));
    }
    const od = E.overdriveInfo(state);
    if (od.equipped) opts.push(opt('Overdrive', od.active ? 'Active today: extra work pays at full rate.' : od.wait ? 'Ready again in ' + plural(od.wait, 'day') + '.' : 'Once a week, extra work up to 120% pays at full rate.', od.canUse ? 'overdrive' : null, od.active ? 'Active' : od.canUse ? 'Activate' : 'Wait', od.active ? 'on' : '', ob('rune')));
    if (E.retestDue(state)) opts.push(opt('Awakening Test', 'Four weeks since your last test. Re-test to place your quest again.', 'retest', 'Re-test', '', ic('trial', 'o-ic')));
    if (opts.length) out += panel('Today', `<div class="opts">${opts.join('')}</div>`);
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

  function cardView() {
    const st = E.stats(state), rank = E.RANKS[state.rank], aura = E.auraOf(state), day = E.today(state), live = E.liveStreak(state);
    const t = E.TITLES.find(x => x.id === state.title);
    const frame = E.ITEMS.some(i => i.kind === 'frame' && i.id === state.frame) ? state.frame : '';
    const card = `<div class="pcard aura-${aura} ${frame}">
      <div class="pc-art">${figure(state.rank >= 4)}<i class="pc-sheen"></i></div>
      <div class="pc-top"><span class="label">Hunter licence</span></div>
      <div class="pc-main">
        ${myCrest('big')}
        <div class="pc-id">
          <div class="pc-name">${esc(state.name)}</div>
          <div class="pc-title">${t ? esc(t.name) : 'No title'}</div>
          <div class="pc-rank">${rank.id} rank &middot; Level ${state.level}</div>
          <div class="pc-aura">${E.AURAS[aura]} aura</div>
          ${state.hard ? '<span class="tag-hard">HARD MODE</span>' : ''}
        </div>
      </div>
      <div class="pc-low">
        <div class="kv">
          <div class="kvc"><span class="label">STR</span>${ic('str')}<b>${st.STR}</b></div>
          <div class="kvc"><span class="label">END</span>${ic('end')}<b>${st.END}</b></div>
          <div class="kvc"><span class="label">AGI</span>${ic('agi')}<b>${st.AGI}</b></div>
        </div>
        <div class="pc-foot"><span>Streak <b>${live.n}</b></span><span>Best <b>${Math.max(state.best, live.n)}</b></span><span>Clears <b>${state.clears + (day.cleared ? 1 : 0)}</b></span></div>
      </div>
    </div>`;

    const statRow = (k, v, p, text) => `<div class="statx"><div class="stat">${ic(k.toLowerCase())}<span>${k}</span><div class="bar">${fill('st-' + k, p)}</div><b>${v}</b></div><small class="note">${text}</small></div>`;
    const strP = (T.strPer - st.strLeft) / T.strPer, sitP = (T.endSitPer - st.sitLeft) / T.endSitPer, runP = (T.endRunPer - st.runLeft) / T.endRunPer, agiP = (T.agiRuns - st.paceRunsLeft) / T.agiRuns;
    const agiText = state.pace.best != null
      ? 'Best pace ' + mmss(state.pace.best) + ' per km. ' + plural(st.paceRunsLeft, 'more timed run') + ' near it, or ' + T.agiPaceStep + ' seconds off it, for the next point.'
      : 'Log a run of 1 km or more with its time to start tracking pace. Every ' + T.agiRuns + ' timed runs near your best pace add a point.';
    const stats = panel('Stats grow only from training',
      statRow('STR', st.STR, strP, st.strLeft + ' more push-ups or squats to the next point.')
      + statRow('END', st.END, Math.max(sitP, runP), st.sitLeft + ' sit-ups or ' + fmt('run', st.runLeft) + ' km to the next point.')
      + statRow('AGI', st.AGI, agiP, agiText));

    const tri = E.trialInfo(state);
    const ladder = E.RANKS.map((r, i) => `<div class="rung ${i <= state.rank ? 'got' : ''} ${i === state.rank ? 'cur' : ''}">${crest(i, i, i <= state.rank ? '' : 'sealed')}<small>Lv ${r.level}</small></div>`).join('');
    const next = !tri.next ? 'You hold the highest rank. Level ' + E.MAX_LEVEL + ' is the cap.'
      : 'Next: <b>' + tri.next.id + ' rank</b>. Level ' + tri.next.level + (tri.levelOk ? ' reached' : ', you are ' + state.level) + ', then a one-day Rank Trial: <b>' + quest4(tri.next.trial) + '</b>. It unlocks: ' + tri.next.unlocks.join('; ') + '.';
    const ranks = panel('Ranks', `<div class="ladder">${ladder}</div><p class="note">${next}</p>
      ${tri.canStart ? '<button class="btn gold" data-act="trial">Start the ' + tri.next.id + '-rank trial</button>' : ''}`);

    const auraPick = panel('Aura', state.rank >= 1
      ? `<div class="swatches">
          <button class="swatch auto ${state.aura == null ? 'on' : ''}" data-act="aura" data-id="auto" aria-label="Follow my rank">Auto</button>
          ${E.AURAS.slice(0, state.rank + 1).map((n, i) => `<button class="swatch aura-${i} ${state.aura === i ? 'on' : ''}" data-act="aura" data-id="${i}" aria-label="${n} aura" title="${n}"></button>`).join('')}
        </div><p class="note">One colour for every rank you have held. From A rank the aura moves.</p>`
      : `<p class="note">Aura colours unlock at D rank. Yours is ${E.AURAS[0]} for now.</p>`);

    const path = E.QUESTS.map(q => `<div class="stat">${ic(q.id)}<span>${q.name}</span><div class="bar">${fill('rd-' + q.id, state.targets[q.id] / q.max)}</div><b>${fmt(q.id, state.targets[q.id])}<small>/${q.max}</small></b></div>`).join('');
    const road = panel('Road to the full routine', `<div class="road">${path}</div><p class="note">${growth()}</p>`);
    return card + stats + ranks + auraPick + road;
  }

  function titlesView() {
    const items = E.TITLES.map(t => {
      const has = state.titles.includes(t.id), on = state.title === t.id;
      return `<button class="title-item ${has ? '' : 'locked'} ${on ? 'on' : ''}" data-act="title" data-id="${t.id}" ${has ? '' : 'disabled'}>
        ${ic(has ? 'star' : 'lock', 'o-ic')}<span class="o-main"><b>${has ? esc(t.name) : '? ? ?'}${t.hard ? ' <i class="tag-hard">HARD</i>' : ''}</b><small>${esc(t.desc)}</small></span>
        <span class="tag ${has ? '' : 'dim'}">${on ? 'EQUIPPED' : has ? 'Equip' : 'Locked'}</span></button>`;
    }).join('');
    return panel('Titles ' + state.titles.length + ' / ' + E.TITLES.length, `<div class="titles">${items}</div>`);
  }

  function skillsView() {
    const slots = E.skillSlots(state), used = state.skills.length;
    const items = E.SKILLS.map(k => {
      const on = state.skills.includes(k.id), lvOk = state.level >= k.level;
      let right;
      if (k.inactive) right = '<span class="tag dim">Later</span>';
      else if (on) right = `<button class="btn small" data-act="skill-off" data-id="${k.id}">Remove</button>`;
      else if (!lvOk) right = `<span class="tag dim">Lv ${k.level}</span>`;
      else if (used >= slots) right = `<span class="tag dim">${slots ? 'Slots full' : 'D rank'}</span>`;
      else right = `<button class="btn small" data-act="skill-on" data-id="${k.id}">Equip</button>`;
      return `<div class="opt ${on ? 'on' : ''} ${!lvOk || k.inactive ? 'locked' : ''}">${ob('rune')}<span class="o-main"><b>${k.name}<i class="lv">Lv ${k.level}</i></b><small>${k.desc}${k.inactive ? ' Needs bonus tasks, which are not designed yet.' : ''}</small></span>${right}</div>`;
    }).join('');
    const pips = Array.from({ length: 3 }, (x, i) => `<i class="pip ${i < used ? 'full' : i < slots ? 'free' : ''}"></i>`).join('');
    return panel('Skill slots ' + used + ' / ' + slots, `<div class="pips">${pips}</div><p class="note">Slots open with rank: one at D, two at C, three at A. Skills unlock by level and can be swapped at any time.</p><div class="opts">${items}</div>`);
  }

  function shopView() {
    const item = it => {
      const owned = state.items.includes(it.id), on = state[it.kind] === it.id, rankOk = state.rank >= it.rank, key = 'buy:' + it.id;
      let right;
      if (on) right = '<span class="tag">EQUIPPED</span>';
      else if (owned) right = `<button class="btn small" data-act="equip" data-kind="${it.kind}" data-id="${it.id}">Equip</button>`;
      else if (!rankOk) right = `<span class="tag dim">${E.RANKS[it.rank].id} rank</span>`;
      else right = `<button class="btn small ${armed === key ? 'on' : ''}" data-act="buy" data-id="${it.id}" ${state.essence >= it.cost ? '' : 'disabled'}>${armed === key ? 'Confirm' : 'Buy'}</button>`;
      return `<div class="opt ${on ? 'on' : ''}"><span class="sw ${it.id}"></span><span class="o-main"><b>${it.name}</b><small>${owned ? 'Owned' : ob('essence') + it.cost + ' Essence'}</small></span>${right}</div>`;
    };
    const base = (kind, name) => `<div class="opt ${state[kind] ? '' : 'on'}"><span class="sw ${kind}-default"></span><span class="o-main"><b>${name}</b><small>Standard issue</small></span>${state[kind] ? `<button class="btn small" data-act="equip" data-kind="${kind}" data-id="">Equip</button>` : '<span class="tag">EQUIPPED</span>'}</div>`;
    const themes = E.ITEMS.filter(i => i.kind === 'theme').map(item).join('');
    const frames = E.ITEMS.filter(i => i.kind === 'frame').map(item).join('');
    return panel('', `<div class="wallet">${ob('essence')}<div><b>${num(state.essence)}</b><span class="label">Essence</span></div></div>
        <p class="note">Every cleared quest drops a chest with Essence, and now and then a cosmetic. Streak milestones pay more. Nothing here makes you stronger.</p>`)
      + panel('Quest window themes', `<div class="opts">${base('theme', 'System Blue')}${themes}</div>`)
      + panel('Card frames, from B rank', `<div class="opts">${base('frame', 'Plain')}${frames}</div>`);
  }

  function hunterScreen() {
    const subs = [['card', 'Card'], ['titles', 'Titles'], ['skills', 'Skills'], ['shop', 'Shop']];
    return head('hunter', 'Hunter', E.RANKS[state.rank].id + '-rank hunter, level ' + state.level + '.')
      + `<div class="subtabs" role="tablist">${subs.map(([k, n]) => `<button class="subtab" role="tab" aria-selected="${sub === k}" data-act="sub" data-id="${k}">${n}</button>`).join('')}</div>`
      + (sub === 'titles' ? titlesView() : sub === 'skills' ? skillsView() : sub === 'shop' ? shopView() : cardView());
  }

  // What a day shows as in the log. Today only shows a result it has already reached.
  function dayResult(k) {
    const d = state.days[k];
    if (!d) return '';
    if (k !== state.lastDay) return d.result || E.resultOf(d);
    const r = E.resultOf(d);
    return r === 'missed' || r === 'weak' ? '' : r;
  }
  function dayDetail(k) {
    const d = state.days[k], isToday = k === state.lastDay, res = dayResult(k);
    const sc = d.score != null ? d.score : d.kind === 'quest' ? E.score(d) : 0;
    const rows = [['Result', (isToday && !d.cleared && d.kind === 'quest' && !d.paused ? 'In progress' : RESULT[res] || 'In progress') + (d.kind === 'quest' && !(d.paused && !d.cleared) ? ', ' + pct(sc) : '')]];
    if (d.kind === 'quest') for (const q of E.QUESTS) rows.push([q.name, fmt(q.id, d.progress[q.id]) + ' / ' + fmt(q.id, d.targets[q.id]) + unit(q.id)]);
    if (k === state.graceDay && !isToday && (res === 'missed' || res === 'weak')) rows.push(['Day of the Awakening Test', 'No penalty']);
    if (d.penalty) rows.push(['Penalty extra', penaltyText(d.penalty) + (E.penaltyDone(d) ? ', done' : isToday ? '' : ', not done')]);
    if (d.trial) rows.push(['Rank Trial', E.RANKS[d.trial.rank].id + (d.trial.passed ? ', passed' : isToday ? ', running' : ', not passed')]);
    if (d.felt) rows.push(['Felt', FELT[d.felt]]);
    rows.push(['XP', Math.round(Number(d.xp) || 0), 'sum']);
    return panel(dateLabel(k) + (isToday ? ', today' : ''), `<div class="rewards">${rewardRows(rows)}</div>`);
  }
  function logScreen() {
    const tk = state.lastDay, d = E.parseKey(tk);
    const start = E.addDays(tk, -((d.getDay() + 6) % 7) - 28);
    const sel = state.days[logSel] ? logSel : tk;
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<div class="dow">${x}</div>`).join('');
    for (let i = 0; i < 35; i++) {
      const k = E.addDays(start, i), has = !!state.days[k], future = k > tk, res = future ? '' : dayResult(k);
      cells += `<button class="cell ${future ? 'future' : res ? 'r-' + res : ''} ${k === tk ? 'today' : ''} ${k === sel ? 'sel' : ''}" data-act="day" data-id="${k}" ${has && !future ? '' : 'disabled'} aria-label="${dateLabel(k)}${res ? ', ' + RESULT[res] : ''}">${Number(k.slice(8))}</button>`;
    }
    const lg = (cls, name) => `<span><i class="cell ${cls}"></i>${name}</span>`;
    const tot = state.totals;
    const stones = E.MILESTONES.map(m => { const got = state.milestones.includes(m.days); return `<div class="stone ${got ? 'got' : ''}">${ob('flame')}<b>${m.days}</b><small>days</small></div>`; }).join('');
    const cell = (icon, label, value, cls) => `<div class="kvc"><span class="label">${label}</span>${icon}<b${cls ? ' class="' + cls + '"' : ''}>${value}</b></div>`;
    return head('log', 'Log', 'The last five weeks. Tap a day.', `<span class="chip">${plural(state.clears + (E.today(state).cleared ? 1 : 0), 'clear')}</span>`)
      + panel('', `<div class="cal">${cells}</div>
        <div class="legend">${lg('r-clear', 'Clear')}${lg('r-near', 'Near clear')}${lg('r-partial', 'Partial')}${lg('r-weak', 'Weak')}${lg('r-missed', 'Missed')}${lg('r-rest', 'Rest')}${lg('r-paused', 'Paused')}</div>`)
      + dayDetail(sel)
      + panel('Streak milestones', `<div class="stones">${stones}</div><p class="note">Each one pays Essence and a title, once.</p>`)
      + panel('Lifetime', `<div class="kv">
          ${cell(ic('pushups'), 'Push-ups', num(tot.pushups))}
          ${cell(ic('situps'), 'Sit-ups', num(tot.situps))}
          ${cell(ic('squats'), 'Squats', num(tot.squats))}
          ${cell(ic('run'), 'Run km', fmt('run', tot.run))}
          ${cell(ic('star'), 'Total XP', num(state.totalXp))}
          ${cell(ob('flame'), 'Best streak', Math.max(state.best, E.liveStreak(state).n))}
          ${cell(ic('clear'), 'Full routine', state.fullClears)}
          ${cell(ic('skull'), 'Penalties', state.penaltyClears)}
          ${cell('', 'Since', dateLabel(state.created), 'sm')}
        </div>`);
  }

  function hallScreen() {
    const h = E.hallInfo(state), rank = E.RANKS[state.rank];
    const req = (ok, title, text, p, key) => `<div class="opt ${ok ? 'on' : ''}"><span class="o-main"><b>${title}</b><small>${text}</small><div class="bar ${ok ? 'ok' : ''}">${fill(key, p)}</div></span><span class="tag ${ok ? '' : 'dim'}">${ok ? 'DONE' : 'OPEN'}</span></div>`;
    let body;
    if (h.state === 'sealed') {
      body = banner('', 'Sealed', 'The Hall opens to hunters who hold ' + h.rankNeed + ' rank and have kept a ' + h.streakNeed + '-day streak. Both. The gate is checked at the daily reset.', '', 'lock')
        + `<div class="opts">${req(h.rankOk, h.rankNeed + ' rank', 'You hold ' + rank.id + ' rank.', state.rank / T.hallRank, 'h-rank')}${req(h.streakOk, h.streakNeed + '-day streak', 'Your best streak is ' + plural(h.best, 'day') + '.', h.best / h.streakNeed, 'h-streak')}</div>`;
    } else if (h.state === 'open') {
      const t = E.TITLES.find(x => x.id === state.title);
      body = banner('ok', 'The Hall is open', 'You earned your place. For now you stand here alone: other hunters arrive with the iOS app.', '', 'hall')
        + `<div class="opts"><div class="opt on">${myCrest('mini')}<span class="o-main"><b>${esc(state.name)}</b><small>${t ? esc(t.name) + ', ' : ''}${rank.id} rank, level ${state.level}</small></span><span class="tag">YOU</span></div></div>`
        + `<p class="note">Stay active. The Hall locks after ${h.idleMax} days without a cleared quest. Days since your last clear: <b>${h.idle}</b>.</p>`;
    } else {
      body = banner('warn', 'Locked', h.idleMax + ' days passed without a cleared quest. Clear ' + h.clearsNeed + ' quests and the Hall opens again.', '', 'lock')
        + `<div class="opts">${req(false, 'Clears since the lock', h.clears + ' of ' + h.clearsNeed + '.', h.clears / h.clearsNeed, 'h-clears')}</div>`;
    }
    return `<section class="keyart hall ${h.state}">
        <div class="ka-art"><i class="ka-scene"></i><i class="ka-scrim"></i>${h.state === 'open' ? '' : ic('lock', 'ka-lock')}</div>
        <span class="chip ${h.state === 'open' ? 'hot' : ''}">${h.state === 'open' ? 'Open' : h.state === 'locked' ? 'Locked' : 'Sealed'}</span>
        <div class="ka-text"><h1 class="win-title">Hunter Hall</h1><div class="win-sub"><span>Where ranked hunters meet.</span></div></div>
      </section>`
      + panel('', body + '<p class="note">In this version the Hall is only its gate. Rankings, friends and guilds need accounts and a server, so they come with the iOS app.</p>');
  }

  function systemScreen() {
    const since = E.daysBetween(state.testDay, state.lastDay), due = E.retestDue(state);
    const hard = state.hard
      ? banner('warn', 'Hard mode is on', 'All XP +' + Math.round(T.hardBonus * 100) + '%. A broken streak wipes your level bar and costs one level. The penalty extra task is doubled. Rank is never lost.',
          state.hardOffPending ? '<p class="note"><b>It switches off when your current streak ends.</b></p><button class="btn small" data-act="hard-keep">Keep Hard mode</button>' : '<button class="btn small" data-act="hard-off">Switch off</button>')
      : `<p class="note">Off by default. All XP +${Math.round(T.hardBonus * 100)}%, its own titles and a marked emblem. The price: a broken streak wipes your level bar and costs one level, and the penalty extra task is doubled.</p><button class="btn danger" data-act="hard-on">Switch on Hard mode</button>`;
    const sick = state.paused
      ? banner('', 'Paused', 'Quest and streak are frozen. There is no penalty while you recover.', '<button class="btn small" data-act="pause-off">I am ready to train</button>', 'shield')
      : `<p class="note">Pause the quest and the streak for as long as you need. Nothing is lost and there is no penalty.</p><button class="btn" data-act="pause-on">Pause: injured or sick</button>`;
    const stash = stashInfo();
    return head('system', 'System', 'Player settings.')
      + panel('Hunter name', `<div class="addrow"><input class="field" id="in-name" maxlength="20" value="${esc(state.name)}" autocomplete="off" aria-label="Hunter name"><button class="btn" data-act="rename">Save</button></div>`)
      + panel('Hard mode', hard)
      + panel('Injured or sick', sick)
      + panel('Awakening Test', `<p class="note">Last test: ${dateLabel(state.testDay)}${since ? ', ' + plural(since, 'day') + ' ago' : ''}. ${due ? '<b>A re-test is due.</b>' : 'A re-test is suggested every four weeks.'} It places each task again: a better result jumps a tier, and stats never go down.</p>
        <button class="btn" data-act="retest">Retake the Awakening Test</button>`)
      + panel('Testing tools', `<p class="note">For trying the prototype. Skipping moves the game clock one day ahead, and an unfinished quest is scored as it stands. Going back to today throws away everything done while skipping.</p>
        <button class="btn" data-act="skip">Skip to tomorrow</button>
        ${testing() ? '<button class="btn ghost" data-act="unskip">Back to today (+' + plural(state.debugOffset, 'day') + ' skipped)</button>' : ''}`)
      + panel('Data', `<p class="note" id="sync-line">${esc(syncText())}</p>
        ${stash ? `<div class="opt"><span class="o-main"><b>Earlier copy on this device</b><small>Level ${stash.state.level}, last played ${dateLabel(stash.state.lastDay)}. It was replaced by your cloud save on ${dateLabel(E.dayKey(new Date(stash.at)))}.</small></span><button class="btn small ${armed === 'stash' ? 'on' : ''}" data-act="stash-use">${armed === 'stash' ? 'Confirm' : 'Use it'}</button></div>` : ''}
        <button class="btn danger" data-act="reset">${armed === 'reset' ? 'Tap again to erase everything' : 'Erase all progress'}</button>`)
      + '<p class="note fine">Prototype 2, rules from the design doc of 26 Nov 2026. GPS and Apple Health runs, reminders and the full Hunter Hall belong to the iOS app.</p>';
  }

  function applySkin() {
    const skin = state && E.ITEMS.some(i => i.kind === 'theme' && i.id === state.theme) ? state.theme.replace('theme-', '') : '';
    if (skin) document.documentElement.dataset.skin = skin; else delete document.documentElement.dataset.skin;
  }
  // A red dot on a tab means something there is waiting for a decision.
  function tabDots() {
    const freeSkill = E.skillSlots(state) > state.skills.length && E.SKILLS.some(k => !k.inactive && state.level >= k.level && !state.skills.includes(k.id));
    return { hunter: E.trialInfo(state).canStart || freeSkill, system: E.retestDue(state) };
  }
  function render() {
    applySkin();
    if (!started) return;
    if (!state) { tabs.hidden = true; app.innerHTML = ''; if (modal !== 'onboard') onboarding(); return; }
    tabs.hidden = false;
    const dots = tabDots();
    document.querySelectorAll('.tab').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      b.classList.toggle('dot', !!dots[b.dataset.tab] && b.dataset.tab !== tab);
    });
    const a = document.activeElement;
    const keep = a && app.contains(a) && a.dataset && a.dataset.act ? [a.dataset.act, a.dataset.id || '', a.dataset.n || '', a.dataset.kind || ''] : null;
    const typed = {};
    app.querySelectorAll('input.field[id]').forEach(i => { if (i.value !== i.defaultValue) typed[i.id] = i.value; });
    const body = tab === 'hunter' ? hunterScreen() : tab === 'log' ? logScreen() : tab === 'hall' ? hallScreen() : tab === 'system' ? systemScreen() : questScreen();
    app.style.setProperty('--now', (performance.now() / 1000).toFixed(2)); // looping effects pick up where they were instead of restarting
    app.dataset.tab = tab;
    app.innerHTML = testBar() + hud() + body;
    for (const id of Object.keys(typed)) { const i = document.getElementById(id); if (i) i.value = typed[id]; } // a half-typed amount survives the redraw
    if (keep) for (const el of app.querySelectorAll('[data-act="' + keep[0] + '"]')) {
      if ((el.dataset.id || '') === keep[1] && (el.dataset.n || '') === keep[2] && (el.dataset.kind || '') === keep[3] && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) {} break; }
    }
    settleMotion(app);
  }

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
    const intro = old
      ? `<p>The System has been updated. Levels come faster, a rank now needs a Rank Trial, and stats grow only from real training. Your name, lifetime totals, XP, streak and history are kept.</p>
         <p class="note">One step is new: the Awakening Test, which places each exercise in one of six tiers.</p>`
      : `<p>Every day the System gives you one quest: push-ups, sit-ups, squats and a run. Clear it to earn XP, level up and climb from E rank to S rank. The goal is <b>100 / 100 / 100 / 5 km</b>. You start at your own level.</p>`;
    modal = 'onboard';
    layer.innerHTML = `<div class="overlay k-onboard" role="dialog" aria-modal="true"><div class="win">
      <i class="orn t"></i><i class="orn b"></i>
      <div class="gate aura-2"><div class="ka-art"><i class="ka-scene"></i>${figure(false)}<i class="ka-scrim"></i></div>
        <span class="chip">${crest(0, 0, 'mini')}Rank E</span>
        <div class="ka-text"><div class="label">System notice</div><h1 class="win-title">Daily Quest</h1><div class="win-sub"><span>${old ? 'System update.' : 'You have qualified as a Player.'}</span></div></div>
      </div>
      ${intro}
      ${banner('', 'Before you start', 'This is a training game, not medical advice. If you have a heart or joint condition, are coming back from an injury, or are not sure, check with a doctor first. Stop if you feel sharp pain, dizziness or chest tightness.', '', 'shield')}
      <div class="form" id="testform">
        <label>Hunter name<input class="field" id="t-name" maxlength="20" placeholder="Player" autocomplete="off" value="${old ? esc(old.name || '') : ''}"></label>
        <h2 class="step">${ic('trial')}Awakening Test</h2>
        <p class="note">Four short tests. Do them fresh, or enter honest recent numbers. You can re-test later.</p>
        ${testForm(old ? { pushups: old.test && old.test.pushups, runMax: old.test && old.test.run } : null)}
        <button class="btn primary" data-act="begin">${old ? 'Continue the climb' : 'Accept the quest'}</button>
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
    tapId = id; tapCount = 0; modal = 'tap';
    const day = E.today(state);
    layer.innerHTML = `<div class="tapzone" role="dialog" aria-modal="true">
      <div class="row"><span class="win-title small">${qname(id)}</span><span class="chip">${fmt(id, day.progress[id])} / ${fmt(id, day.targets[id])} so far</span></div>
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
    buzz(12);
  }
  let plank = null, plankTimer = null, wake = null;
  const plankElapsed = () => plank ? plank.acc + (plank.since ? (Date.now() - plank.since) / 1000 : 0) : 0;
  function plankMode() {
    const p = E.today(state).penalty;
    if (!p || p.type !== 'plank') return;
    plank = { acc: 0, since: null, left: Math.max(0, p.need - p.done), rung: false };
    modal = 'plank';
    layer.innerHTML = `<div class="tapzone warn" role="dialog" aria-modal="true">
      <div class="row"><span class="win-title small">Plank</span><span class="chip">${mmss(p.done)} / ${mmss(p.need)} so far</span></div>
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
      plank.rung = true; buzz([200, 100, 200]);
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
  function add(id, n, minutes) {
    if (!state) return;
    const ev = E.addProgress(state, id, n, { hour: now().getHours(), minutes });
    if (!ev.length) { toast('That could not be logged.', 'warn'); render(); return; } // a paused or rest day, or a save loaded from the cloud mid-count
    if (qsel === id && ev.some(e => e.type === 'task' && e.id === id)) qsel = null; // the task is done: the open row moves on to the next one
    save(); render(); handle(ev);
  }
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
    pick(id) { qsel = openQuest(E.today(state)) === id ? 'none' : id; render(); },
    'chest-open'() { openChest(); },
    add(id, el) { buzz(10); add(id, parseFloat(el.dataset.n)); },
    'add-custom'(id) {
      const inp = $('#in-' + id), v = readNum(inp);
      if (!(v > 0)) { if (inp) inp.focus(); toast('Enter a number first', 'warn'); return; }
      inp.value = '';
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
      closeLayer(); tab = 'quest'; save(); render();
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
      inp.value = inp.defaultValue; // the redraw then shows the saved name
      done(E.rename(state, v), 'Name saved');
    },
    skip() {
      if (!state.debugOffset) { pretestMem = JSON.stringify(state); store.set(PRETEST, pretestMem); } // the real progress, kept aside
      state.debugOffset = (state.debugOffset || 0) + 1;
      tab = 'quest';
      const ev = E.ensureDay(state, todayKey());
      writeLocal(); render(); window.scrollTo(0, 0); handle(ev);
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
      meta.dead = meta.dead.concat(state.sid).slice(-30); saveMeta();
      state = null; queue = []; pretestMem = null; logSel = null; qsel = null; tab = 'quest'; sub = 'card';
      store.del(KEY); store.del(PRETEST); store.del(STASH); store.del(V1KEY); store.del(V1KEY + '.done');
      cloudDirty(true);
      closeLayer(); render();
    },
  };

  document.addEventListener('click', e => {
    const tb = e.target.closest('.tab');
    if (tb) { tab = tb.dataset.tab; armed = null; render(); window.scrollTo(0, 0); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const was = armed, fn = ACTS[el.dataset.act];
    armed = null;
    if (fn && (state || el.dataset.act === 'begin')) fn(el.dataset.id, el, was);
  });
  document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#testform')) previewTest(); });
  document.addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.keep; if (k) openDetails[k] = e.target.open; }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal !== 'onboard') {
      const b = layer.querySelector('[data-act="close-modal"], [data-act="tap-cancel"], [data-act="pl-cancel"]');
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
    else { const cd = $('#cd'); if (cd) cd.textContent = countdown(); }
  }
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
      render(); handle(ev);
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
    layer.innerHTML = '<div class="overlay k-splash"><div class="win center"><i class="orn t"></i><i class="orn b"></i><div class="label">System</div><div class="spinner"></div><h2 class="big-word mid">SYNCING</h2><p class="note">Looking for your saved progress.</p></div></div>';
    Promise.race([settled, new Promise(res => setTimeout(res, 3500))]).then(start);
  } else start();
  // The opened chest first shows in the middle of a reveal, so it is fetched ahead of time.
  setTimeout(() => { new Image().src = A + 'chest-open.webp'; }, 2500);
})();
