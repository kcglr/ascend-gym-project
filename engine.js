// Daily Quest game engine, version 2.
// Follows "Daily Quest: Leveling & Rewards Design" (26 Nov 2026). Numbers marked GUESS are either
// the doc's own guesses or fill a gap the doc leaves open. They all live in the tables at the top.
// Pure logic: no DOM, no storage, no clock. Every function takes the player state (plain JSON) and
// returns events for the UI to show, so this file can move unchanged into the iOS app.
const Engine = (() => {
  const VERSION = 2;
  const RESET_HOUR = 4; // GUESS (doc): the game day rolls over at 4:00 AM local time
  const MAX_LEVEL = 100;

  const QUESTS = [
    { id: 'pushups', name: 'Push-ups', unit: 'reps', stat: 'STR', max: 100 },
    { id: 'situps', name: 'Sit-ups', unit: 'reps', stat: 'END', max: 100 },
    { id: 'squats', name: 'Squats', unit: 'reps', stat: 'STR', max: 100 },
    { id: 'run', name: 'Run', unit: 'km', stat: 'END', max: 5 },
  ];
  const QUEST_IDS = QUESTS.map(q => q.id);

  // The six tiers from the design doc: each task's daily target and its XP multiplier.
  const TIERS = [
    { tier: 1, pushups: 10, situps: 10, squats: 15, run: 1, mult: 1.0 },
    { tier: 2, pushups: 20, situps: 20, squats: 30, run: 1.5, mult: 1.2 },
    { tier: 3, pushups: 35, situps: 35, squats: 50, run: 2, mult: 1.4 },
    { tier: 4, pushups: 50, situps: 50, squats: 70, run: 3, mult: 1.6 },
    { tier: 5, pushups: 75, situps: 75, squats: 85, run: 4, mult: 1.8 },
    { tier: 6, pushups: 100, situps: 100, squats: 100, run: 5, mult: 2.0 },
  ];

  // Awakening Test: the lowest result that places a task in tiers 2, 3, 4, 5 and 6.
  const PLACEMENT = {
    pushups: [6, 13, 21, 31, 41],     // most push-ups in one set (doc)
    situps: [10, 18, 26, 36, 46],     // GUESS: sit-ups in 60 seconds (the doc leaves these to testing)
    squats: [15, 25, 35, 45, 55],     // GUESS: squats in 60 seconds (the doc leaves these to testing)
    run12: [1.2, 1.5, 1.8, 2.1, 2.4], // km covered in 12 minutes (doc)
    runMax: [1.5, 2, 3, 4, 5],        // GUESS: longest run without stopping already covers that tier's daily distance
  };

  // A rank needs its level and a one-day Rank Trial. `unlocks` lists only what this build contains.
  const RANKS = [
    { id: 'E', level: 1, trial: null, unlocks: ['Daily quest', 'Profile card'] },
    { id: 'D', level: 10, trial: { pushups: 25, situps: 25, squats: 25, run: 1.5 }, unlocks: ['First skill slot', 'Aura colours'] },
    { id: 'C', level: 25, trial: { pushups: 50, situps: 50, squats: 50, run: 2.5 }, unlocks: ['Second skill slot', 'Hunter Hall, with a 30-day streak'] },
    { id: 'B', level: 45, trial: { pushups: 70, situps: 70, squats: 70, run: 3.5 }, unlocks: ['Card frames'] },
    { id: 'A', level: 65, trial: { pushups: 85, situps: 85, squats: 85, run: 4.5 }, unlocks: ['Third skill slot', 'Animated aura'] },
    { id: 'S', level: 85, trial: { pushups: 100, situps: 100, squats: 100, run: 5 }, unlocks: ['S-rank emblem', 'Title: Limit Breaker'] },
  ];
  const SKILL_SLOTS = [0, 1, 2, 2, 3, 3]; // by rank: 1 slot at D, 2 at C, 3 at A
  const AURAS = ['Ash', 'Verdant', 'Azure', 'Violet', 'Crimson', 'Gold']; // one per rank, grey at E up to gold at S

  // GUESS: every number here is a first pick from the design doc unless the comment says otherwise.
  const TUNING = {
    taskXp: 25,            // XP for one task at 100%, before the tier multiplier
    clearBonus: 50,        // all four tasks at 100%
    overflowCap: 0.2,      // work from 100% to 120% of a target still counts
    overflowRate: 0.5,     // ... at half rate
    streakPerDay: 0.02,    // +2% XP per streak day
    streakCap: 0.5,        // up to +50% at 25 days
    apexCap: 0.6,          // with the Apex Pace skill
    hardBonus: 0.2,        // Hard mode: all XP +20% (applied on top of the streak bonus)
    earlyBonus: 0.1,       // Early Riser skill
    earlyHour: 9,
    nearClear: 0.75,       // quest score that still grows the streak
    partial: 0.25,         // below this the day is a weak effort and tomorrow is a Penalty Quest
    restEvery: 14,         // full clears in a row for one rest token
    restCap: 1,
    deepRestCap: 2,        // with the Deep Rest skill
    trialRetryDays: 3,
    plankMinutes: 4,       // penalty plank, capped at one minute per overall tier
    penaltyExtra: 0.2,     // or +20% on the weakest task
    rampPct: 0.1,          // targets move about 10% at a time
    rampClears: 5,         // up: 5 clears in the last 7 days, at most once a week
    rampWindow: 7,
    downBadDays: 3,        // down: 3 days under 50% in a week
    downBelow: 0.5,
    hardVotes: 2,          // two "too hard" answers in a week block the next increase
    retestDays: 28,
    hallRank: 2,           // Hunter Hall: C rank ...
    hallStreak: 30,        // ... and a 30-day best streak
    hallIdleDays: 14,      // locks again after 14 days without a cleared quest
    hallReopenClears: 7,   // and reopens after 7 clears
    strPer: 250,           // STR +1 per 250 lifetime push-ups + squats
    endSitPer: 200,        // END +1 per 200 sit-ups
    endRunPer: 10,         // END +1 per 10 km
    agiPaceStep: 5,        // AGI +1 each time the best pace improves by 5 s/km
    agiRuns: 5,            // AGI +1 per 5 runs at target pace
    targetPaceSlack: 1.15, // GUESS: "target pace" is within 15% of your best pace (the doc does not define it)
    chestBase: 10,         // GUESS: Essence in a clear chest = 10 + 5 per overall tier above 1
    chestPerTier: 5,
    chestItemChance: 0.04, // GUESS: a chest "sometimes" holds a cosmetic (about one a month)
    secondWindDays: 30,
    overdriveDays: 7,
    keepDays: 400,         // day records kept for the log
    undoDepth: 40,
  };
  const MILESTONES = [
    { days: 7, essence: 50 }, { days: 30, essence: 150 }, { days: 100, essence: 400 }, { days: 365, essence: 1000 }, // GUESS: Essence amounts
  ];

  // `test(state, today, stats)`. Streak titles use the best streak, which only moves at the daily reset.
  const TITLES = [
    { id: 'awakened', name: 'The Awakened', desc: 'Finish the Awakening Test', test: () => true },
    { id: 'seven', name: 'Seven Dawns', desc: '7-day streak', test: s => s.best >= 7 },
    { id: 'iron', name: 'Iron Habit', desc: '30-day streak', test: s => s.best >= 30 },
    { id: 'hundredfold', name: 'Hundredfold', desc: 'First day with 100 push-ups', test: (s, day) => !!day && day.progress.pushups >= 100 },
    { id: 'road', name: 'Road Eater', desc: '100 km run in total', test: s => s.totals.run >= 100 },
    { id: 'brink', name: 'Back from the Brink', desc: 'Clear 5 Penalty Quests', test: s => s.penaltyClears >= 5 },
    { id: 'unbroken', name: 'Unbroken', desc: '100-day streak', test: s => s.best >= 100 },
    { id: 'limit', name: 'Limit Breaker', desc: 'Reach S rank', test: s => s.rank >= 5 },
    { id: 'year', name: 'One Year, No Excuses', desc: '365-day streak', test: s => s.best >= 365 },
    // GUESS: stat-gated titles. The doc says some rewards need a stat and gives "STR 100" as its example.
    { id: 'str100', name: 'Mountain Arms', desc: 'Strength 100', test: (s, day, st) => st.STR >= 100 },
    { id: 'end100', name: 'Deep Lungs', desc: 'Endurance 100', test: (s, day, st) => st.END >= 100 },
    { id: 'agi50', name: 'Tailwind', desc: 'Agility 50', test: (s, day, st) => st.AGI >= 50 },
    // GUESS: the hard-mode title line.
    { id: 'oath', name: 'Oathbound', desc: '7 clears in Hard mode', hard: true, test: s => s.hardClears >= 7 },
    { id: 'edge', name: 'Edge Walker', desc: '30 clears in Hard mode', hard: true, test: s => s.hardClears >= 30 },
  ];

  const SKILLS = [
    { id: 'secondWind', name: 'Second Wind', level: 10, desc: 'Once a month, a failed Penalty Quest does not break the streak.' },
    { id: 'earlyRiser', name: 'Early Riser', level: 15, desc: '+10% XP for tasks finished before 9 AM.' },
    { id: 'splitFocus', name: 'Split Focus', level: 20, desc: 'Pick one task a day to count double toward its stat.' },
    { id: 'overdrive', name: 'Overdrive', level: 30, desc: 'Once a week, the overflow bonus pays at full rate up to 120%.' },
    { id: 'deepRest', name: 'Deep Rest', level: 40, desc: 'Holds 2 rest tokens instead of 1.' },
    { id: 'instinct', name: "Hunter's Instinct", level: 50, desc: "Shows tomorrow's bonus task a day early.", inactive: true }, // bonus tasks are not designed yet
    { id: 'apexPace', name: 'Apex Pace', level: 70, desc: 'Streak bonus cap rises from +50% to +60%.' },
  ];

  // GUESS: a small shop so Essence has a use. Quest window themes for everyone, card frames from B rank.
  const ITEMS = [
    { id: 'theme-crimson', kind: 'theme', name: 'Crimson', cost: 300, rank: 0 },
    { id: 'theme-violet', kind: 'theme', name: 'Violet', cost: 300, rank: 0 },
    { id: 'theme-emerald', kind: 'theme', name: 'Emerald', cost: 300, rank: 0 },
    { id: 'theme-amber', kind: 'theme', name: 'Amber', cost: 300, rank: 0 },
    { id: 'frame-circuit', kind: 'frame', name: 'Circuit', cost: 600, rank: 3 },
    { id: 'frame-obsidian', kind: 'frame', name: 'Obsidian', cost: 900, rank: 3 },
    { id: 'frame-gilded', kind: 'frame', name: 'Gilded', cost: 1200, rank: 3 },
  ];

  // ---------- small helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const round1 = n => Math.round(n * 10) / 10;
  const round2 = n => Math.round(n * 100) / 100;
  const round6 = n => Math.round(n * 1e6) / 1e6;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  const int = v => Math.max(0, Math.floor(num(v)));
  const questById = id => QUESTS.find(q => q.id === id);
  const has = (s, skill) => s.skills.includes(skill);
  const ok = extra => Object.assign({ ok: true, ev: [] }, extra);
  const fail = why => ({ ok: false, why, ev: [] });
  function zeroes(v) { const o = {}; for (const id of QUEST_IDS) o[id] = v; return o; }

  // ---------- days ----------
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // The game day a moment belongs to: a session at 1 AM still counts for the day before.
  function gameDay(d) { return dayKey(new Date(d.getTime() - RESET_HOUR * 3600000)); }
  function nextReset(d) {
    const g = new Date(d.getTime() - RESET_HOUR * 3600000);
    return new Date(g.getFullYear(), g.getMonth(), g.getDate() + 1, RESET_HOUR);
  }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dayKey(d); }
  function today(s) { return s.days[s.lastDay]; }

  // ---------- tiers and the Awakening Test ----------
  function tierOf(id, target) { let t = 1; for (const row of TIERS) if (target >= row[id] - 1e-9) t = row.tier; return t; }
  function tiersOf(targets) { const o = {}; for (const id of QUEST_IDS) o[id] = tierOf(id, targets[id]); return o; }
  function overallTier(tiers) { return Math.floor(QUEST_IDS.reduce((a, id) => a + tiers[id], 0) / QUEST_IDS.length); }
  const multOf = tier => TIERS[tier - 1].mult;
  function targetsFor(tiers) { const o = {}; for (const id of QUEST_IDS) o[id] = TIERS[tiers[id] - 1][id]; return o; }
  function isFullRoutine(targets) { return QUESTS.every(q => targets[q.id] >= q.max); }

  function cleanTest(t) {
    t = t || {};
    return { pushups: int(t.pushups), situps: int(t.situps), squats: int(t.squats), run12: round2(num(t.run12)), runMax: round2(num(t.runMax)), knee: !!t.knee };
  }
  function place(bounds, v) { let t = 1; for (const b of bounds) if (v >= b) t++; return t; }
  // Each exercise is placed on its own. The run takes the better of the 12-minute result and the longest nonstop run.
  function placeTest(test) {
    const t = cleanTest(test);
    return {
      pushups: place(PLACEMENT.pushups, t.pushups),
      situps: place(PLACEMENT.situps, t.situps),
      squats: place(PLACEMENT.squats, t.squats),
      run: Math.max(place(PLACEMENT.run12, t.run12), place(PLACEMENT.runMax, t.runMax)),
    };
  }
  // GUESS: stats start from the test so a fit beginner does not start at zero.
  function baseStats(tiers) {
    return { STR: 2 * (tiers.pushups + tiers.squats), END: 2 * (tiers.situps + tiers.run), AGI: 4 * tiers.run };
  }
  // The 12-minute test also gives a pace, which feeds Agility.
  function testPace(test) { return test.run12 >= 1 ? Math.round(720 / test.run12) : null; }

  // ---------- XP, levels, ranks ----------
  function xpForNext(level) { return level >= MAX_LEVEL ? Infinity : Math.round(100 + 10 * Math.pow(level, 1.2)); }
  function gainXp(s, n, ev) {
    s.xp += n; s.totalXp += n;
    while (s.level < MAX_LEVEL && s.xp >= xpForNext(s.level)) {
      s.xp -= xpForNext(s.level); s.level++;
      if (ev) ev.push({ type: 'level', level: s.level });
    }
  }
  function loseXp(s, n) {
    s.xp -= n; s.totalXp = Math.max(0, s.totalXp - n);
    while (s.xp < 0 && s.level > 1) { s.level--; s.xp += xpForNext(s.level); }
    if (s.xp < 0) s.xp = 0;
  }
  function streakBonus(s, streak) {
    return Math.min(has(s, 'apexPace') ? TUNING.apexCap : TUNING.streakCap, TUNING.streakPerDay * streak);
  }

  // ---------- scoring ----------
  function completion(day, id) { return Math.min(1, day.progress[id] / day.targets[id]); }
  function score(day) { let t = 0; for (const id of QUEST_IDS) t += completion(day, id); return t / QUEST_IDS.length; }
  function penaltyDone(day) {
    const p = day.penalty;
    if (!p || !day.cleared) return false;
    return p.type === 'plank' ? p.done >= p.need : day.progress[p.id] >= p.need;
  }
  function resultOf(day) {
    if (day.kind === 'rest') return 'rest';
    if (day.paused && !day.cleared) return 'paused';
    if (day.cleared) return 'clear';
    const sc = score(day);
    if (sc >= TUNING.nearClear) return 'near';
    if (sc >= TUNING.partial) return 'partial';
    return sc > 0 ? 'weak' : 'missed';
  }

  // Today's XP as a pure function of what is logged, so undo and rule switches can never drift.
  function breakdown(s, day) {
    day = day || today(s);
    const out = { tasks: 0, overflow: 0, early: 0, clear: 0, streakPct: 0, streak: 0, hard: 0, total: 0 };
    if (!day || day.kind !== 'quest') return out;
    for (const id of QUEST_IDS) {
      const ratio = day.progress[id] / day.targets[id];
      const base = TUNING.taskXp * multOf(day.tiers[id]);
      const t = base * Math.min(1, ratio);
      const o = base * clamp(round6(ratio - 1), 0, TUNING.overflowCap) * (day.overdrive ? 1 : TUNING.overflowRate);
      out.tasks += t; out.overflow += o;
      if (day.early && day.early[id]) out.early += (t + o) * TUNING.earlyBonus;
    }
    if (day.cleared) out.clear = TUNING.clearBonus;
    const base = out.tasks + out.overflow + out.early + out.clear;
    out.streakPct = streakBonus(s, day.streak0);
    out.streak = base * out.streakPct;
    out.hard = s.hard ? (base + out.streak) * TUNING.hardBonus : 0;
    out.total = Math.round(round6(base + out.streak + out.hard));
    return out;
  }
  // Pays (or takes back) the difference between today's XP and what was already paid today.
  function reprice(s, ev) {
    const day = today(s);
    if (!day) return 0;
    const x = breakdown(s, day).total, d = x - day.xp;
    day.xp = x;
    if (d > 0) gainXp(s, d, ev); else if (d < 0) loseXp(s, -d);
    return d;
  }

  // ---------- stats: only from real training ----------
  function stats(s) {
    const day = today(s);
    const credit = id => s.totals[id] + s.focus[id] + (day && day.focus === id ? day.progress[id] : 0);
    const str = credit('pushups') + credit('squats'), sit = credit('situps'), run = credit('run');
    const paceGain = s.pace.base != null ? Math.max(0, Math.floor((s.pace.base - s.pace.best) / TUNING.agiPaceStep)) : 0;
    return {
      STR: s.statBase.STR + Math.floor(str / TUNING.strPer),
      END: s.statBase.END + Math.floor(sit / TUNING.endSitPer) + Math.floor(run / TUNING.endRunPer),
      AGI: s.statBase.AGI + paceGain + Math.floor(s.paceRuns / TUNING.agiRuns),
      strLeft: TUNING.strPer - Math.floor(str % TUNING.strPer),
      sitLeft: TUNING.endSitPer - Math.floor(sit % TUNING.endSitPer),
      runLeft: round2(TUNING.endRunPer - (run % TUNING.endRunPer)),
      paceRunsLeft: TUNING.agiRuns - (s.paceRuns % TUNING.agiRuns),
    };
  }

  function checkTitles(s, ev) {
    const day = today(s), st = stats(s), gained = [];
    for (const t of TITLES) {
      if (!s.titles.includes(t.id) && t.test(s, day, st)) {
        s.titles.push(t.id); gained.push(t.id);
        if (ev) ev.push({ type: 'title', id: t.id, name: t.name });
      }
    }
    return gained;
  }

  // ---------- new player ----------
  function cleanName(name) { return String(name || '').trim().slice(0, 20) || 'Player'; }
  function newPlayer(name, test, todayKey, seed) {
    const t = cleanTest(test), tiers = placeTest(t), pace = testPace(t);
    const s = {
      v: VERSION, sid: 'p' + Math.abs(Math.floor(Number(seed) || 1)).toString(36), seed: Math.abs(Math.floor(Number(seed) || 1)),
      name: cleanName(name), created: todayKey,
      graceDay: todayKey, // GUESS: the day of the Awakening Test never brings a penalty (the doc calls the test "the first quest")
      test: t, testDay: todayKey,
      targets: targetsFor(tiers), adjustDay: todayKey, lastDown: null,
      level: 1, xp: 0, totalXp: 0, rank: 0, trialRetry: null,
      streak: 0, best: 0, clears: 0, fullClears: 0, hardClears: 0, lastClear: null, milestones: [],
      clearRun: 0, restTokens: 0,
      hard: false, hardOffPending: false, paused: false,
      penaltyOwed: false, penaltyCount: 0, penaltyClears: 0,
      totals: zeroes(0), focus: zeroes(0),
      statBase: baseStats(tiers), pace: { base: pace, best: pace }, paceRuns: 0,
      titles: [], title: null,
      essence: 0, items: [], theme: null, frame: null, aura: null,
      skills: [], skillUse: {},
      hall: { state: 'sealed', idle: 0, clears: 0 },
      days: {}, lastDay: null,
    };
    ensureDay(s, todayKey);
    checkTitles(s, null);
    s.title = 'awakened';
    return s;
  }

  function newDay(s) {
    const day = { kind: 'quest', targets: { ...s.targets }, tiers: tiersOf(s.targets), progress: zeroes(0), streak0: s.streak, cleared: false, xp: 0, log: [] };
    if (s.paused) day.paused = true;
    else if (s.penaltyOwed) { day.penalty = makePenalty(s, day); s.penaltyOwed = false; }
    return day;
  }

  // ---------- Penalty Quest ----------
  function weakestTask(day) {
    let w = QUEST_IDS[0];
    for (const id of QUEST_IDS) {
      const a = day.tiers[id], b = day.tiers[w];
      if (a < b || (a === b && day.targets[id] / questById(id).max < day.targets[w] / questById(w).max)) w = id;
    }
    return w;
  }
  function extraNeed(id, target, pct) {
    return id === 'run' ? Math.ceil(target * (1 + pct) * 10 - 1e-9) / 10 : Math.ceil(target * (1 + pct) - 1e-9);
  }
  // The normal quest plus one extra task. The System alternates between a plank and +20% on the weakest
  // task. Both scale with the player's tier, and Hard mode doubles them.
  function makePenalty(s, day) {
    s.penaltyCount++;
    const times = s.hard ? 2 : 1;
    if (s.penaltyCount % 2 === 1) {
      const minutes = Math.min(TUNING.plankMinutes, overallTier(day.tiers)) * times;
      return { type: 'plank', need: minutes * 60, done: 0 };
    }
    const id = weakestTask(day), pct = TUNING.penaltyExtra * times;
    return { type: 'extra', id, pct: Math.round(pct * 100), need: extraNeed(id, day.targets[id], pct) };
  }

  // ---------- chests ----------
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  // Decided by the day, not by chance at the moment of opening, so undo and redo give the same chest.
  function makeChest(s, key, day) {
    const chest = { essence: TUNING.chestBase + TUNING.chestPerTier * (overallTier(day.tiers) - 1) };
    if (hash01(s.seed + ':' + key) < TUNING.chestItemChance) {
      const pool = ITEMS.filter(i => !s.items.includes(i.id) && i.rank <= s.rank);
      if (pool.length) chest.item = pool[Math.floor(hash01(s.seed + ':item:' + key) * pool.length)].id;
    }
    return chest;
  }
  function removeItem(s, id) {
    s.items = s.items.filter(x => x !== id);
    if (s.theme === id) s.theme = null;
    if (s.frame === id) s.frame = null;
  }

  // ---------- logging ----------
  function canLog(s) { const d = today(s); return !!d && d.kind === 'quest' && !d.paused; }

  // A timed run of at least 1 km sets the pace record and can count as a run at target pace (once a day).
  function recordPace(s, day, km, minutes, entry) {
    minutes = Number(minutes);
    if (!(minutes > 0) || km < 1) return;
    const pace = Math.round(minutes * 60 / km);
    if (pace < 150 || pace > 1500) return; // not a believable running or walking pace, so the time is ignored
    const prev = { base: s.pace.base, best: s.pace.best };
    let counted = false;
    if (!day.paced && (prev.best == null || pace <= prev.best * TUNING.targetPaceSlack)) { s.paceRuns++; day.paced = true; counted = true; }
    if (prev.best == null) s.pace = { base: pace, best: pace };
    else if (pace < prev.best) s.pace.best = pace;
    entry.min = round2(minutes);
    entry.pace = { prev, counted };
  }

  // id is a quest id, or 'plank' on a Penalty Quest day. ctx: { hour, minutes } (time of day, run duration).
  function addProgress(s, id, amount, ctx) {
    const ev = [];
    const day = today(s);
    if (!canLog(s)) return ev;
    ctx = ctx || {};
    const isPlank = id === 'plank';
    if (isPlank ? !(day.penalty && day.penalty.type === 'plank') : !QUEST_IDS.includes(id)) return ev;
    amount = id === 'run' ? round2(Number(amount)) : Math.round(Number(amount));
    if (!(amount > 0)) return ev;
    amount = Math.min(amount, id === 'run' ? 50 : isPlank ? 3600 : 500);

    const entry = { id, amount };
    const st0 = stats(s), penalty0 = penaltyDone(day);
    if (isPlank) {
      day.penalty.done += amount;
    } else {
      const before = day.progress[id], target = day.targets[id];
      const after = round2(before + amount);
      day.progress[id] = after;
      s.totals[id] = round2(s.totals[id] + amount);
      if (before < target && after >= target) {
        ev.push({ type: 'task', id, name: questById(id).name });
        if (has(s, 'earlyRiser') && ctx.hour != null && ctx.hour >= RESET_HOUR && ctx.hour < TUNING.earlyHour) {
          day.early = day.early || {};
          day.early[id] = true; entry.early = true;
        }
      }
      if (id === 'run') recordPace(s, day, amount, ctx.minutes, entry);
    }
    let clear = null;
    if (!day.cleared && QUEST_IDS.every(k => day.progress[k] >= day.targets[k])) {
      day.cleared = true;
      const chest = makeChest(s, s.lastDay, day);
      day.chest = chest; entry.chest = chest;
      s.essence += chest.essence;
      if (chest.item) s.items.push(chest.item);
      clear = { type: 'clear', chest, full: isFullRoutine(day.targets) };
    }
    if (!penalty0 && penaltyDone(day)) ev.push({ type: 'penaltyCleared' });
    checkTrial(s, day, ev, entry);
    entry.xp = reprice(s, ev);
    const st1 = stats(s);
    for (const k of ['STR', 'END', 'AGI']) if (st1[k] > st0[k]) ev.push({ type: 'stat', stat: k, value: st1[k], gain: st1[k] - st0[k] });
    const gained = checkTitles(s, ev);
    if (gained.length) entry.titles = gained;
    day.log.push(entry);
    if (day.log.length > TUNING.undoDepth) day.log.shift();
    if (clear) ev.push(clear);
    ev.unshift({ type: 'xp', amount: entry.xp });
    return ev;
  }

  // Undo the last logged set today, with everything it earned.
  function undo(s) {
    const day = today(s);
    if (!canLog(s) || !day.log || !day.log.length) return null;
    const e = day.log.pop();
    if (e.id === 'plank') {
      if (day.penalty) day.penalty.done = Math.max(0, day.penalty.done - e.amount);
    } else {
      day.progress[e.id] = Math.max(0, round2(day.progress[e.id] - e.amount));
      s.totals[e.id] = Math.max(0, round2(s.totals[e.id] - e.amount));
    }
    if (e.early && day.early) {
      delete day.early[e.id];
      if (!Object.keys(day.early).length) delete day.early;
    }
    if (e.pace) {
      s.pace = e.pace.prev;
      if (e.pace.counted) { s.paceRuns = Math.max(0, s.paceRuns - 1); delete day.paced; }
    }
    if (e.chest) {
      day.cleared = false; delete day.chest; delete day.felt;
      s.essence = Math.max(0, s.essence - e.chest.essence);
      if (e.chest.item) removeItem(s, e.chest.item);
    }
    if (e.rank !== undefined) { s.rank = e.rank; if (day.trial) day.trial.passed = false; }
    if (e.titles) {
      s.titles = s.titles.filter(t => !e.titles.includes(t));
      if (!s.titles.includes(s.title)) s.title = s.titles.includes('awakened') ? 'awakened' : (s.titles[0] || null);
    }
    return { id: e.id, amount: e.amount, xp: -reprice(s, null) };
  }

  // ---------- Rank Trials ----------
  function trialInfo(s) {
    const day = today(s), next = RANKS[s.rank + 1] || null;
    const info = { next, levelOk: !!next && s.level >= next.level, active: day && day.trial && !day.trial.passed ? day.trial : null, wait: 0, canStart: false };
    if (!next || !day) return info;
    if (s.trialRetry && s.lastDay < s.trialRetry) info.wait = daysBetween(s.lastDay, s.trialRetry);
    info.canStart = info.levelOk && !info.wait && canLog(s) && !day.trial;
    return info;
  }
  function checkTrial(s, day, ev, entry) {
    const t = day.trial;
    if (!t || t.passed || !QUEST_IDS.every(k => day.progress[k] >= t.req[k])) return;
    t.passed = true;
    if (entry) entry.rank = s.rank;
    s.rank = t.rank;
    ev.push({ type: 'rank', rank: RANKS[s.rank].id, unlocks: RANKS[s.rank].unlocks });
  }
  // Everything logged today counts toward the trial. Not passing costs nothing but a 3-day wait.
  function startTrial(s) {
    const info = trialInfo(s), day = today(s);
    if (!info.canStart) return fail(!info.next ? 'You already hold the highest rank.' : !info.levelOk ? 'Reach level ' + info.next.level + ' first.' : info.wait ? 'You can try again in ' + info.wait + ' day' + (info.wait === 1 ? '' : 's') + '.' : 'A trial cannot start right now.');
    day.trial = { rank: s.rank + 1, req: { ...info.next.trial }, passed: false };
    const res = ok({ trial: day.trial });
    checkTrial(s, day, res.ev, day.log[day.log.length - 1]);
    const gained = checkTitles(s, res.ev);
    if (gained.length && day.log.length) { const e = day.log[day.log.length - 1]; e.titles = (e.titles || []).concat(gained); }
    return res;
  }

  // ---------- the daily reset ----------
  function breakStreak(s, rep) {
    const lost = s.streak;
    s.streak = 0;
    if (lost > 0) {
      rep.broke = { lost };
      // Hard mode: the XP in the level bar is wiped and the player drops one level. Rank is never lost.
      if (s.hard) {
        rep.broke.hard = { levelFrom: s.level, xp: s.xp };
        s.xp = 0;
        if (s.level > 1) s.level--;
        rep.broke.hard.levelTo = s.level;
      }
    }
    if (s.hardOffPending) { s.hard = false; s.hardOffPending = false; rep.hardOff = true; }
  }

  function stepUp(id, t) {
    const max = questById(id).max;
    if (t >= max) return max;
    let next = max;
    for (const row of TIERS) if (row[id] > t + 1e-9) { next = row[id]; break; }
    const up = id === 'run' ? round1(t + Math.max(0.1, round1(t * TUNING.rampPct))) : t + Math.max(1, Math.round(t * TUNING.rampPct));
    return Math.min(next, up); // a target stops at each tier's number on the way up
  }
  function stepDown(id, t) {
    const down = id === 'run' ? round1(t - Math.max(0.1, round1(t * TUNING.rampPct))) : t - Math.max(1, Math.round(t * TUNING.rampPct));
    return Math.max(TIERS[0][id], down);
  }
  // Looks at the last 7 days that used the current targets and moves them, at most once a week.
  function reviewTargets(s, k, rep) {
    let from = addDays(k, -(TUNING.rampWindow - 1));
    if (s.adjustDay > from) from = s.adjustDay;
    let clears = 0, bad = 0, hard = 0;
    for (let d = from; d <= k; d = addDays(d, 1)) {
      const day = s.days[d];
      if (!day || !day.result || day.result === 'rest' || day.result === 'paused') continue;
      if (day.result === 'clear') clears++;
      if (day.score < TUNING.downBelow && d !== s.graceDay) bad++;
      if (day.felt === 'hard') hard++;
    }
    const before = { ...s.targets };
    if (bad >= TUNING.downBadDays && (!s.lastDown || daysBetween(s.lastDown, k) >= TUNING.rampWindow)) {
      for (const id of QUEST_IDS) s.targets[id] = stepDown(id, s.targets[id]);
      s.lastDown = k; s.adjustDay = addDays(k, 1);
      if (QUEST_IDS.some(id => s.targets[id] !== before[id])) rep.targets.push({ dir: 'down', from: before, to: { ...s.targets } });
      return;
    }
    if (daysBetween(s.adjustDay, k) + 1 >= TUNING.rampWindow && clears >= TUNING.rampClears && !isFullRoutine(s.targets)) {
      s.adjustDay = addDays(k, 1);
      if (hard >= TUNING.hardVotes) { rep.targets.push({ dir: 'held' }); return; }
      const t0 = tiersOf(before);
      for (const id of QUEST_IDS) s.targets[id] = stepUp(id, s.targets[id]);
      const t1 = tiersOf(s.targets);
      rep.targets.push({ dir: 'up', from: before, to: { ...s.targets }, tierUps: QUEST_IDS.filter(id => t1[id] > t0[id]).map(id => ({ id, tier: t1[id] })) });
    }
  }

  function reviewHall(s, res, rep) {
    const h = s.hall;
    if (res === 'paused') return; // sick days never count against the player
    if (res === 'clear') h.idle = 0; else h.idle++;
    if (h.state === 'sealed') {
      if (s.rank >= TUNING.hallRank && s.best >= TUNING.hallStreak) { h.state = 'open'; h.idle = 0; rep.hall = 'opened'; }
    } else if (h.state === 'open') {
      if (h.idle >= TUNING.hallIdleDays) { h.state = 'locked'; h.clears = 0; rep.hall = 'locked'; }
    } else if (res === 'clear') {
      h.clears++;
      if (h.clears >= TUNING.hallReopenClears) { h.state = 'open'; rep.hall = 'reopened'; }
    }
  }

  // Scores one finished day: result tier, streak, penalties, rest tokens, milestones, trial, targets.
  function settleDay(s, k, rep) {
    const day = s.days[k];
    const res = resultOf(day);
    day.result = res;
    day.score = day.kind === 'quest' ? round2(score(day)) : 0;
    const r = { key: k, result: res, score: day.score };
    rep.days.push(r);
    if (res === 'paused') {
      if (day.penalty && !penaltyDone(day)) s.penaltyOwed = true; // the penalty waits until the player is back
    } else if (res !== 'rest') {
      if (res === 'missed') rep.missed++;
      if (res === 'clear') {
        s.clears++; s.lastClear = k;
        if (isFullRoutine(day.targets)) s.fullClears++;
        if (s.hard) s.hardClears++;
      }
      const grows = res === 'clear' || res === 'near';
      if (day.penalty) {
        const wind = s.skillUse.secondWind;
        if (penaltyDone(day)) { s.streak++; s.penaltyClears++; r.penalty = 'cleared'; }
        else if (s.streak > 0 && has(s, 'secondWind') && (!wind || daysBetween(wind, k) >= TUNING.secondWindDays)) {
          s.skillUse.secondWind = k; r.penalty = 'saved'; rep.secondWind = true;
          if (grows) s.streak++;
        } else { r.penalty = 'failed'; rep.penaltyFailed = true; breakStreak(s, rep); }
      } else if (grows) s.streak++;
      if (res === 'weak' || res === 'missed') {
        if (k === s.graceDay) r.grace = true; // awakened late in the day: nothing is owed for it
        else s.penaltyOwed = true;
      }
      if (s.streak > s.best) s.best = s.streak;
      for (const m of MILESTONES) {
        if (s.best >= m.days && !s.milestones.includes(m.days)) { s.milestones.push(m.days); s.essence += m.essence; rep.milestones.push(m); }
      }
      // Rest is earned: one token per 14 full clears in a row, and the count stops while the pouch is full.
      if (res !== 'clear') s.clearRun = 0;
      else if (s.restTokens < tokenCap(s)) {
        s.clearRun++;
        if (s.clearRun >= TUNING.restEvery) { s.restTokens++; s.clearRun = 0; rep.tokens++; }
      }
      if (day.focus) s.focus[day.focus] = round2(s.focus[day.focus] + day.progress[day.focus]);
      if (day.trial && !day.trial.passed) { s.trialRetry = addDays(k, TUNING.trialRetryDays); rep.trialFailed = RANKS[day.trial.rank].id; }
    }
    reviewHall(s, res, rep);
    if (res !== 'paused') reviewTargets(s, k, rep);
    r.streak = s.streak;
    delete day.log;
  }

  // Call when the app opens and on a timer. Scores every finished day and opens today's quest.
  function ensureDay(s, key) {
    const ev = [];
    if (!s.lastDay) { s.lastDay = key; s.days[key] = newDay(s); return ev; }
    const gap = daysBetween(s.lastDay, key);
    if (gap <= 0) return ev; // same day, or the clock moved backwards: never punish that
    const rep = { type: 'report', days: [], missed: 0, tokens: 0, milestones: [], targets: [], streakFrom: s.streak, levelFrom: s.level };
    let k = s.lastDay;
    for (let i = 0; i < gap; i++) {
      if (!s.days[k]) s.days[k] = newDay(s); // a day the app was never opened
      settleDay(s, k, rep);
      k = addDays(k, 1);
    }
    s.lastDay = key;
    s.days[key] = newDay(s);
    rep.streakTo = s.streak;
    rep.penalty = today(s).penalty || null;
    const keys = Object.keys(s.days).sort();
    while (keys.length > TUNING.keepDays) delete s.days[keys.shift()];
    ev.push(rep);
    checkTitles(s, ev);
    return ev;
  }

  // What the streak will be if the day ends now.
  function liveStreak(s) {
    const day = today(s);
    if (!day || day.kind !== 'quest' || (day.paused && !day.cleared)) return { n: s.streak, state: 'frozen' };
    if (day.penalty) return penaltyDone(day) ? { n: s.streak + 1, state: 'grown' } : { n: s.streak, state: 'risk' };
    const sc = score(day);
    if (day.cleared || sc >= TUNING.nearClear) return { n: s.streak + 1, state: 'grown' };
    return { n: s.streak, state: sc >= TUNING.partial ? 'hold' : 'low' };
  }

  // ---------- rest, sick mode, hard mode ----------
  function tokenCap(s) { return has(s, 'deepRest') ? TUNING.deepRestCap : TUNING.restCap; }
  function restInfo(s) {
    const day = today(s);
    const info = { tokens: s.restTokens, cap: tokenCap(s), run: s.clearRun, every: TUNING.restEvery, resting: !!day && day.kind === 'rest', canUse: false, why: '' };
    if (!day || info.resting) return info;
    if (!s.restTokens) info.why = 'No rest token yet.';
    else if (day.paused) info.why = 'The quest is paused.';
    else if (day.penalty) info.why = 'A Penalty Quest cannot be skipped.';
    else if (day.trial) info.why = 'A Rank Trial is running today.';
    else if (QUEST_IDS.some(id => day.progress[id] > 0)) info.why = 'Rest has to be chosen before you log anything.';
    else info.canUse = true;
    return info;
  }
  // Freezes the streak for today: no XP and no penalty. The count toward the next token restarts.
  function useRestToken(s) {
    const info = restInfo(s), day = today(s);
    if (!info.canUse) return fail(info.why || 'Today is already a rest day.');
    day.kind = 'rest';
    day.restPrev = s.clearRun;
    s.restTokens--; s.clearRun = 0;
    return ok();
  }
  function cancelRest(s) {
    const day = today(s);
    if (!day || day.kind !== 'rest') return fail('Today is not a rest day.');
    day.kind = 'quest';
    s.restTokens++; s.clearRun = day.restPrev || 0;
    delete day.restPrev;
    return ok();
  }

  // Injured or sick mode: the quest and the streak pause for as long as needed, with no penalty.
  function setPaused(s, on) {
    const day = today(s);
    s.paused = !!on;
    if (!day || day.kind !== 'quest') return ok();
    if (on) { if (!day.cleared) day.paused = true; }
    else if (day.paused) {
      delete day.paused;
      if (!day.penalty && s.penaltyOwed) { day.penalty = makePenalty(s, day); s.penaltyOwed = false; }
    }
    return ok();
  }

  // Hard mode can be switched on at any time. Switching it off waits until the current streak ends.
  function setHard(s, on) {
    const res = ok();
    if (on) { s.hard = true; s.hardOffPending = false; }
    else if (s.hard && s.streak > 0) { s.hardOffPending = true; res.pending = true; }
    else { s.hard = false; s.hardOffPending = false; }
    reprice(s, res.ev);
    return res;
  }

  function setFelt(s, v) {
    const day = today(s);
    if (!day || !day.cleared || !['easy', 'right', 'hard'].includes(v)) return fail('Clear the quest first.');
    day.felt = v;
    return ok();
  }

  // ---------- skills ----------
  function skillSlots(s) { return SKILL_SLOTS[s.rank]; }
  function equipSkill(s, id) {
    const k = SKILLS.find(x => x.id === id);
    if (!k || k.inactive) return fail('That skill is not active in this build.');
    if (has(s, id)) return ok();
    if (s.level < k.level) return fail('Unlocks at level ' + k.level + '.');
    if (s.skills.length >= skillSlots(s)) return fail(skillSlots(s) ? 'All skill slots are full.' : 'The first skill slot opens at D rank.');
    s.skills.push(id);
    const res = ok();
    reprice(s, res.ev);
    return res;
  }
  function unequipSkill(s, id) {
    s.skills = s.skills.filter(x => x !== id);
    const day = today(s);
    if (id === 'splitFocus' && day) delete day.focus;
    const res = ok();
    reprice(s, res.ev);
    return res;
  }
  function setFocus(s, id) {
    const day = today(s);
    if (!has(s, 'splitFocus') || !day || day.kind !== 'quest') return fail('Equip Split Focus first.');
    if (id && !QUEST_IDS.includes(id)) return fail('Unknown task.');
    if (id) day.focus = id; else delete day.focus;
    return ok();
  }
  function overdriveInfo(s) {
    const day = today(s), last = s.skillUse.overdrive;
    const wait = last ? Math.max(0, TUNING.overdriveDays - daysBetween(last, s.lastDay)) : 0;
    return { equipped: has(s, 'overdrive'), active: !!(day && day.overdrive), wait, canUse: has(s, 'overdrive') && canLog(s) && !day.overdrive && !wait };
  }
  function activateOverdrive(s) {
    if (!overdriveInfo(s).canUse) return fail('Overdrive is not ready.');
    today(s).overdrive = true;
    s.skillUse.overdrive = s.lastDay;
    const res = ok();
    reprice(s, res.ev);
    return res;
  }

  // ---------- cosmetics ----------
  function buyItem(s, id) {
    const it = ITEMS.find(x => x.id === id);
    if (!it) return fail('Unknown item.');
    if (s.items.includes(id)) return ok();
    if (s.rank < it.rank) return fail('Unlocks at ' + RANKS[it.rank].id + ' rank.');
    if (s.essence < it.cost) return fail('Not enough Essence.');
    s.essence -= it.cost;
    s.items.push(id);
    return ok();
  }
  function equipItem(s, kind, id) {
    if (kind !== 'theme' && kind !== 'frame') return fail('Unknown slot.');
    if (id && !(s.items.includes(id) && ITEMS.some(x => x.id === id && x.kind === kind))) return fail('You do not own that.');
    s[kind] = id || null;
    return ok();
  }
  // null follows the current rank. Choosing a colour needs D rank, and only colours of ranks already held.
  function setAura(s, idx) {
    if (idx == null) { s.aura = null; return ok(); }
    if (s.rank < 1) return fail('Aura colours unlock at D rank.');
    if (!(idx >= 0 && idx <= s.rank)) return fail('That aura is not unlocked yet.');
    s.aura = idx;
    return ok();
  }
  function auraOf(s) { return s.aura != null && s.aura <= s.rank ? s.aura : s.rank; }
  function setTitle(s, id) {
    if (!s.titles.includes(id)) return fail('That title is still locked.');
    s.title = id;
    return ok();
  }
  function rename(s, name) { s.name = cleanName(name); return ok(); }

  // ---------- Hunter Hall ----------
  function hallInfo(s) {
    return {
      state: s.hall.state, rankOk: s.rank >= TUNING.hallRank, rankNeed: RANKS[TUNING.hallRank].id,
      best: s.best, streakNeed: TUNING.hallStreak, streakOk: s.best >= TUNING.hallStreak,
      idle: s.hall.idle, idleMax: TUNING.hallIdleDays, clears: s.hall.clears, clearsNeed: TUNING.hallReopenClears,
    };
  }

  // ---------- re-test ----------
  function retestDue(s) { return daysBetween(s.testDay, s.lastDay) >= TUNING.retestDays; }
  // Each task is placed again. A higher result jumps to that tier, a lower one steps down to it, and a
  // task that stays in its tier keeps the weekly progress it has made. Stats never go down.
  function retest(s, test) {
    const t = cleanTest(test), placed = placeTest(t), cur = tiersOf(s.targets), day = today(s);
    for (const id of QUEST_IDS) if (placed[id] !== cur[id]) s.targets[id] = TIERS[placed[id] - 1][id];
    s.test = t; s.testDay = s.lastDay;
    const base = baseStats(placed);
    for (const k of Object.keys(base)) s.statBase[k] = Math.max(s.statBase[k], base[k]);
    const pace = testPace(t);
    if (pace != null) {
      if (s.pace.best == null) s.pace = { base: pace, best: pace };
      else if (pace < s.pace.best) s.pace.best = pace;
    }
    const fresh = !!day && day.kind === 'quest' && !day.cleared && !day.trial && QUEST_IDS.every(id => day.progress[id] === 0);
    if (fresh) {
      day.targets = { ...s.targets };
      day.tiers = tiersOf(s.targets);
      if (day.penalty && day.penalty.type === 'extra') day.penalty.need = extraNeed(day.penalty.id, day.targets[day.penalty.id], day.penalty.pct / 100);
    }
    s.adjustDay = fresh ? s.lastDay : addDays(s.lastDay, 1);
    const res = ok({ targets: { ...s.targets }, today: fresh });
    checkTitles(s, res.ev);
    return res;
  }

  // ---------- coming from the first prototype ----------
  // Keeps the name, lifetime totals, XP, streak and history. Tiers come from a fresh Awakening Test.
  function migrateV1(old, name, test, todayKey, seed) {
    old = old || {};
    const s = newPlayer(name || old.name, test, todayKey, seed);
    if (typeof old.created === 'string' && old.created <= todayKey) s.created = old.created;
    for (const id of QUEST_IDS) s.totals[id] = round2(num(old.totals && old.totals[id]));
    s.streak = int(old.streak); s.best = Math.max(int(old.best), s.streak); s.clears = int(old.clears);
    const days = old.days || {};
    for (const k of Object.keys(days)) {
      const d = days[k];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k >= todayKey || !d || !d.targets || !d.progress) continue;
      const day = { kind: 'quest', targets: zeroes(1), progress: zeroes(0), streak0: 0, cleared: !!d.cleared, xp: int(d.xp) };
      for (const id of QUEST_IDS) { day.targets[id] = num(d.targets[id]) || 1; day.progress[id] = round2(num(d.progress[id])); }
      day.tiers = tiersOf(day.targets);
      day.score = round2(score(day));
      day.result = resultOf(day);
      s.days[k] = day;
    }
    const day = today(s), od = days[todayKey];
    if (od && od.progress) {
      // Reps already logged today count toward the new quest. Their XP was paid under the old rules.
      for (const id of QUEST_IDS) day.progress[id] = round2(num(od.progress[id]));
      day.cleared = QUEST_IDS.every(id => day.progress[id] >= day.targets[id]);
    }
    day.streak0 = s.streak;
    day.xp = breakdown(s, day).total;
    gainXp(s, int(old.totalXp), null);
    checkTitles(s, null);
    return s;
  }

  return {
    VERSION, RESET_HOUR, MAX_LEVEL, QUESTS, QUEST_IDS, TIERS, PLACEMENT, RANKS, SKILL_SLOTS, AURAS, TUNING, MILESTONES, TITLES, SKILLS, ITEMS,
    dayKey, gameDay, nextReset, parseKey, addDays, daysBetween, today,
    tierOf, tiersOf, overallTier, multOf, targetsFor, placeTest, isFullRoutine,
    xpForNext, streakBonus, score, completion, resultOf, penaltyDone, breakdown, stats, liveStreak,
    newPlayer, ensureDay, canLog, addProgress, undo,
    trialInfo, startTrial, restInfo, useRestToken, cancelRest, setPaused, setHard, setFelt,
    skillSlots, equipSkill, unequipSkill, setFocus, overdriveInfo, activateOverdrive,
    buyItem, equipItem, setAura, auraOf, setTitle, rename, hallInfo, retestDue, retest, migrateV1,
  };
})();

if (typeof module !== 'undefined') module.exports = Engine;
