// Daily Quest game engine.
// Pure logic, no DOM and no storage. Every function takes the player state and returns
// events for the UI to show. This file is meant to move unchanged into a React Native /
// Expo app later; only the storage and UI layers need rewriting.
const Engine = (() => {
  const VERSION = 1;

  const QUESTS = [
    { id: 'pushups', name: 'Push-ups', unit: 'reps', stat: 'STR', max: 100 },
    { id: 'situps', name: 'Sit-ups', unit: 'reps', stat: 'VIT', max: 100 },
    { id: 'squats', name: 'Squats', unit: 'reps', stat: 'AGI', max: 100 },
    { id: 'run', name: 'Run', unit: 'km', stat: 'END', max: 5 },
  ];
  const QUEST_IDS = QUESTS.map(q => q.id);

  // GUESS: level bands for ranks. S rank lands around 5 months of steady full-routine days.
  const RANKS = [
    { id: 'E', min: 1 }, { id: 'D', min: 10 }, { id: 'C', min: 20 },
    { id: 'B', min: 35 }, { id: 'A', min: 50 }, { id: 'S', min: 70 },
  ];

  // GUESS: tuning numbers. Easy to change in one place.
  const TUNING = {
    xpPerRep: 1,
    xpPerKm: 25,
    questBonus: 20,
    clearBonus: 50,
    streakBonusPerDay: 10, // added to clear bonus, capped at 10 days
    overflowCap: 2,        // reps past 2x the target earn no XP
    rampRepsPct: 0.03,     // targets grow ~3% after each cleared day
    rampRepsMin: 1,
    rampRunKm: 0.1,
    detrainAfterMissed: 3, // missing 3+ days in a row lowers targets ~10%
  };

  const TITLES = [
    { id: 'awakened', name: 'The Awakened', desc: 'Took the fitness test', test: () => true },
    { id: 'first', name: 'First Clear', desc: 'Cleared a daily quest', test: s => s.clears >= 1 },
    { id: 'streak3', name: 'Three-Day Discipline', desc: '3-day streak', test: s => s.best >= 3 },
    { id: 'streak7', name: 'Week of Iron', desc: '7-day streak', test: s => s.best >= 7 },
    { id: 'rankD', name: 'D-Rank Hunter', desc: 'Reach level 10', test: s => s.level >= 10 },
    { id: 'k1', name: 'Thousand-Rep Arms', desc: '1,000 lifetime push-ups', test: s => s.totals.pushups >= 1000 },
    { id: 'road', name: 'Road Runner', desc: '50 km lifetime running', test: s => s.totals.run >= 50 },
    { id: 'centurion', name: 'Centurion', desc: 'A rep quest reaches 100', test: s => ['pushups', 'situps', 'squats'].some(k => s.targets[k] >= 100) },
    { id: 'streak30', name: 'Unbroken Month', desc: '30-day streak', test: s => s.best >= 30 },
    { id: 'rankB', name: 'B-Rank Hunter', desc: 'Reach level 35', test: s => s.level >= 35 },
    { id: 'limit', name: 'Limit Breaker', desc: 'Clear the full 100/100/100/5 km routine', test: s => s.fullClears >= 1 },
    { id: 'rankS', name: 'S-Rank', desc: 'Reach level 70', test: s => s.level >= 70 },
  ];

  const pad = n => String(n).padStart(2, '0');
  const round2 = n => Math.round(n * 100) / 100;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const r5 = n => Math.round(n / 5) * 5;

  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function daysBetween(a, b) {
    return Math.round((parseKey(b) - parseKey(a)) / 86400000);
  }
  function addDays(k, n) {
    const d = parseKey(k);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }

  function xpForNext(level) {
    return 100 + (level - 1) * 30;
  }
  function rankFor(level) {
    let r = RANKS[0];
    for (const x of RANKS) if (level >= x.min) r = x;
    return r.id;
  }

  // GUESS: daily target = 2x what you can do in one set (spread over the day), from 10 to 100.
  // Run target = your current longest run, rounded to 0.5 km, from 0.5 to 5 km.
  function startTargets(test) {
    const reps = x => clamp(r5((Number(x) || 0) * 2), 10, 100);
    return {
      pushups: reps(test.pushups),
      situps: reps(test.situps),
      squats: reps(test.squats),
      run: clamp(Math.round((Number(test.run) || 0) * 2) / 2, 0.5, 5),
    };
  }

  function zeroes(v) {
    const o = {};
    for (const id of QUEST_IDS) o[id] = v;
    return o;
  }

  function newDay(state) {
    return { targets: { ...state.targets }, progress: zeroes(0), done: zeroes(false), cleared: false, xp: 0, log: [] };
  }

  function newPlayer(name, test, today) {
    const s = {
      v: VERSION,
      name: (name || 'Player').trim().slice(0, 20) || 'Player',
      created: today,
      test: { ...test },
      level: 1, xp: 0, totalXp: 0,
      targets: startTargets(test),
      streak: 0, best: 0, clears: 0, fullClears: 0,
      questCounts: zeroes(0),
      totals: zeroes(0),
      titles: [], title: null,
      days: {},
      lastDay: null,
    };
    const ev = ensureDay(s, today);
    checkTitles(s, ev);
    s.title = 'awakened';
    return s;
  }

  function stats(s) {
    const o = {};
    for (const q of QUESTS) o[q.stat] = 10 + s.questCounts[q.id];
    return o;
  }

  function today(s) {
    return s.days[s.lastDay];
  }

  // Call on app open and on a timer. Rolls the game over to a new day and applies penalties.
  function ensureDay(s, todayKey) {
    const ev = [];
    if (!s.lastDay) {
      s.lastDay = todayKey;
      s.days[todayKey] = newDay(s);
      return ev;
    }
    if (s.lastDay === todayKey) return ev;
    const gap = daysBetween(s.lastDay, todayKey);
    if (gap < 0) {
      // Clock moved backwards. Do not punish; just make sure the day exists.
      if (!s.days[todayKey]) s.days[todayKey] = newDay(s);
      s.lastDay = todayKey;
      return ev;
    }
    const last = s.days[s.lastDay];
    const missed = (last && last.cleared ? 0 : 1) + (gap - 1);
    if (missed > 0) {
      const lost = s.streak;
      s.streak = 0;
      let detrained = false;
      if (missed >= TUNING.detrainAfterMissed) {
        for (const id of ['pushups', 'situps', 'squats']) s.targets[id] = Math.max(10, r5(s.targets[id] * 0.9));
        s.targets.run = Math.max(0.5, round2(s.targets.run - 0.5));
        detrained = true;
      }
      ev.push({ type: 'penalty', missed, lostStreak: lost, detrained });
    }
    s.lastDay = todayKey;
    s.days[todayKey] = newDay(s);
    return ev;
  }

  function gainXp(s, n, ev) {
    s.xp += n;
    s.totalXp += n;
    while (s.xp >= xpForNext(s.level)) {
      s.xp -= xpForNext(s.level);
      const oldRank = rankFor(s.level);
      s.level++;
      const rank = rankFor(s.level);
      ev.push({ type: 'level', level: s.level, rank, rankUp: rank !== oldRank });
    }
  }

  function loseXp(s, n) {
    s.xp -= n;
    s.totalXp = Math.max(0, s.totalXp - n);
    while (s.xp < 0 && s.level > 1) {
      s.level--;
      s.xp += xpForNext(s.level);
    }
    if (s.xp < 0) s.xp = 0;
  }

  function checkTitles(s, ev) {
    for (const t of TITLES) {
      if (!s.titles.includes(t.id) && t.test(s)) {
        s.titles.push(t.id);
        ev.push({ type: 'title', id: t.id, name: t.name });
      }
    }
  }

  function rampTargets(s) {
    for (const id of ['pushups', 'situps', 'squats']) {
      const t = s.targets[id];
      s.targets[id] = Math.min(100, t + Math.max(TUNING.rampRepsMin, Math.round(t * TUNING.rampRepsPct)));
    }
    s.targets.run = Math.min(5, round2(s.targets.run + TUNING.rampRunKm));
  }

  function isFullRoutine(targets) {
    return QUESTS.every(q => targets[q.id] >= q.max);
  }

  function addProgress(s, id, amount) {
    const ev = [];
    const day = today(s);
    const q = QUESTS.find(x => x.id === id);
    if (!day || !q) return ev;
    amount = id === 'run' ? round2(Number(amount)) : Math.round(Number(amount));
    if (!(amount > 0)) return ev;
    if (id !== 'run') amount = Math.min(amount, 500);
    else amount = Math.min(amount, 50);

    const target = day.targets[id];
    const before = day.progress[id];
    const after = round2(before + amount);
    day.progress[id] = after;
    s.totals[id] = round2(s.totals[id] + amount);

    const cap = target * TUNING.overflowCap;
    const units = Math.max(0, Math.min(after, cap) - Math.min(before, cap));
    let xp = Math.round(id === 'run' ? units * TUNING.xpPerKm : units * TUNING.xpPerRep);

    const entry = { id, amount, xp: 0, quest: false, clear: null };
    if (!day.done[id] && after >= target) {
      day.done[id] = true;
      s.questCounts[id]++;
      xp += TUNING.questBonus;
      entry.quest = true;
      ev.push({ type: 'quest', id, name: q.name, stat: q.stat });
    }
    if (!day.cleared && QUEST_IDS.every(k => day.done[k])) {
      day.cleared = true;
      const prevTargets = { ...s.targets };
      const prevBest = s.best;
      s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.clears++;
      const full = isFullRoutine(day.targets);
      if (full) s.fullClears++;
      const bonus = TUNING.clearBonus + TUNING.streakBonusPerDay * Math.min(s.streak, 10);
      xp += bonus;
      rampTargets(s);
      entry.clear = { prevTargets, prevBest, full };
      ev.push({ type: 'clear', bonus, streak: s.streak, full, next: { ...s.targets } });
    }
    entry.xp = xp;
    day.xp += xp;
    day.log.push(entry);
    ev.unshift({ type: 'xp', amount: xp });
    gainXp(s, xp, ev);
    checkTitles(s, ev);
    return ev;
  }

  // Undo the last logged action today. Titles stay earned.
  function undo(s) {
    const day = today(s);
    if (!day || !day.log.length) return null;
    const e = day.log.pop();
    day.progress[e.id] = Math.max(0, round2(day.progress[e.id] - e.amount));
    s.totals[e.id] = Math.max(0, round2(s.totals[e.id] - e.amount));
    if (e.clear) {
      day.cleared = false;
      s.streak = Math.max(0, s.streak - 1);
      s.best = e.clear.prevBest;
      s.clears = Math.max(0, s.clears - 1);
      if (e.clear.full) s.fullClears = Math.max(0, s.fullClears - 1);
      s.targets = { ...e.clear.prevTargets };
    }
    if (e.quest) {
      day.done[e.id] = false;
      s.questCounts[e.id] = Math.max(0, s.questCounts[e.id] - 1);
    }
    day.xp -= e.xp;
    loseXp(s, e.xp);
    return e;
  }

  // Retaking the test resets future targets. Today changes too if it is not cleared yet.
  function retest(s, test) {
    s.test = { ...test };
    s.targets = startTargets(test);
    const day = today(s);
    if (day && !day.cleared) {
      day.targets = { ...s.targets };
      for (const id of QUEST_IDS) {
        if (!day.done[id] && day.progress[id] >= day.targets[id]) {
          day.done[id] = true;
          s.questCounts[id]++;
        }
      }
    }
    return s.targets;
  }

  return {
    VERSION, QUESTS, RANKS, TITLES, TUNING,
    dayKey, parseKey, addDays, daysBetween,
    xpForNext, rankFor, startTargets, newPlayer, ensureDay, addProgress, undo, retest, stats, today,
  };
})();

if (typeof module !== 'undefined') module.exports = Engine;
