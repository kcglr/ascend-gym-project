// Rule tests for the Daily Quest engine. Run: node tests/engine.test.js
const assert = require('node:assert/strict');
const E = require('../engine.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failures.push({ name, err }); }
}
const clone = o => JSON.parse(JSON.stringify(o));
const START = '2026-11-26';

// The person this prototype is tuned for: 25 to 30 push-ups in a set, runs 5 km without stopping.
const TRAINED = { pushups: 28, situps: 30, squats: 40, run12: 0, runMax: 5 };
const BEGINNER = { pushups: 3, situps: 5, squats: 8, run12: 0.9, runMax: 0 };
const ELITE = { pushups: 60, situps: 60, squats: 70, run12: 3, runMax: 10 };

// A player past the day of the Awakening Test, which is the only day that can never bring a penalty.
// Most rules below are about ordinary days, so the helper drops that mark. `fresh` keeps it.
function fresh(test, seed) { return E.newPlayer('Tester', test || BEGINNER, START, seed || 7); }
function player(test, seed) { const s = fresh(test, seed); delete s.graceDay; return s; }
function next(s, n) { return E.ensureDay(s, E.addDays(s.lastDay, n || 1)); }
function report(ev) { return ev.find(e => e.type === 'report'); }
// Log a fraction of every target for today.
function doDay(s, frac, ctx) {
  const day = E.today(s);
  let ev = [];
  for (const id of E.QUEST_IDS) {
    const want = id === 'run' ? Math.round(day.targets[id] * frac * 100) / 100 : Math.ceil(day.targets[id] * frac);
    const left = Math.round((want - day.progress[id]) * 100) / 100;
    if (left > 0) ev = ev.concat(E.addProgress(s, id, left, ctx));
  }
  return ev;
}
function clearDay(s) {
  const ev = doDay(s, 1);
  const p = E.today(s).penalty;
  if (p && p.type === 'plank') E.addProgress(s, 'plank', p.need - p.done);
  if (p && p.type === 'extra') E.addProgress(s, p.id, Math.round((p.need - E.today(s).progress[p.id]) * 100) / 100);
  return ev;
}
function clearDays(s, n) { for (let i = 0; i < n; i++) { clearDay(s); next(s); } }

// ---------- the Awakening Test ----------
test('the stated starting point places push-ups at tier 4 and the run at tier 6', () => {
  const t = E.placeTest({ pushups: 25, runMax: 5 });
  assert.equal(t.pushups, 4);
  assert.equal(t.run, 6);
  assert.equal(E.placeTest({ pushups: 30 }).pushups, 4);
  const s = player(TRAINED);
  assert.equal(s.targets.pushups, 50);
  assert.equal(s.targets.run, 5);
  assert.equal(E.today(s).tiers.run, 6);
});
test('tier boundaries follow the design table', () => {
  const p = n => E.placeTest({ pushups: n }).pushups;
  assert.deepEqual([0, 5, 6, 12, 13, 20, 21, 30, 31, 40, 41, 99].map(p), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  const r = km => E.placeTest({ run12: km }).run;
  assert.deepEqual([1.19, 1.2, 1.49, 1.5, 1.8, 2.1, 2.39, 2.4, 3].map(r), [1, 2, 2, 3, 4, 5, 5, 6, 6]);
  assert.equal(E.placeTest({ run12: 1.3, runMax: 4 }).run, 5, 'the better of the two run answers counts');
});
test('a beginner starts on tier 1 targets and an elite player on the full routine', () => {
  assert.deepEqual(player(BEGINNER).targets, { pushups: 10, situps: 10, squats: 15, run: 1 });
  const s = player(ELITE);
  assert.deepEqual(s.targets, { pushups: 100, situps: 100, squats: 100, run: 5 });
  assert.ok(E.isFullRoutine(s.targets));
  assert.equal(E.overallTier(E.today(s).tiers), 6);
});
test('each exercise is placed on its own and the overall tier is the average, rounded down', () => {
  const s = player({ pushups: 3, situps: 50, squats: 30, runMax: 5 });
  assert.deepEqual(E.today(s).tiers, { pushups: 1, situps: 6, squats: 3, run: 6 });
  assert.equal(E.overallTier(E.today(s).tiers), 4);
});

// ---------- XP and levels ----------
test('level curve matches the design doc', () => {
  assert.equal(E.xpForNext(1), 110);
  assert.ok(Math.abs(E.xpForNext(10) - 260) <= 3);
  assert.ok(Math.abs(E.xpForNext(65) - 1600) <= 5);
  assert.ok(Math.abs(E.xpForNext(99) - 2580) <= 5);
  assert.equal(E.xpForNext(100), Infinity);
});
test('a full clear at tier 1 pays 100 task XP plus the 50 clear bonus', () => {
  const s = player();
  clearDay(s);
  const b = E.breakdown(s);
  assert.equal(b.tasks, 100);
  assert.equal(b.clear, 50);
  assert.equal(b.total, 150);
  assert.equal(s.totalXp, 150);
  assert.equal(s.level, 2);
  assert.equal(s.xp, 40);
});
test('harder tiers pay more: 25 x tier multiplier per task', () => {
  const s = player(TRAINED); // tiers 4, 4, 4, 6
  clearDay(s);
  assert.equal(E.breakdown(s).tasks, 40 + 40 + 40 + 50);
  assert.equal(E.breakdown(s).total, 220);
});
test('partial progress is paid in proportion', () => {
  const s = player();
  E.addProgress(s, 'pushups', 5); // half of 10
  assert.equal(s.totalXp, 13); // 12.5 rounded
  E.addProgress(s, 'pushups', 5);
  assert.equal(s.totalXp, 25);
});
test('overflow from 100% to 120% pays at half rate and nothing beyond', () => {
  const s = player();
  E.addProgress(s, 'pushups', 10);
  assert.equal(s.totalXp, 25);
  E.addProgress(s, 'pushups', 2); // 120%
  assert.equal(E.breakdown(s).overflow, 2.5);
  assert.equal(s.totalXp, 28);
  const at120 = s.totalXp;
  E.addProgress(s, 'pushups', 50);
  assert.equal(s.totalXp, at120);
  assert.equal(E.today(s).progress.pushups, 62, 'the reps are still recorded');
  assert.equal(s.totals.pushups, 62);
});
test('streak bonus is +2% per streak day and caps at +50%', () => {
  const s = player();
  assert.equal(E.streakBonus(s, 0), 0);
  assert.ok(Math.abs(E.streakBonus(s, 7) - 0.14) < 1e-9);
  assert.equal(E.streakBonus(s, 25), 0.5);
  assert.equal(E.streakBonus(s, 300), 0.5);
  clearDays(s, 30);
  clearDay(s);
  assert.equal(E.today(s).streak0, 30);
  assert.equal(E.breakdown(s).streakPct, 0.5);
});
test('level never passes 100', () => {
  const s = player(ELITE);
  s.level = 99; s.xp = 0;
  for (let i = 0; i < 20; i++) { clearDay(s); next(s); }
  assert.equal(s.level, 100);
  assert.ok(s.xp >= 0);
});

// ---------- undo ----------
test('undo takes back exactly what a set earned, including a clear, its chest and a level', () => {
  const s = player();
  doDay(s, 0.5);
  E.addProgress(s, 'pushups', 5); E.addProgress(s, 'situps', 5); E.addProgress(s, 'squats', 8);
  const before = clone(s);
  const ev = E.addProgress(s, 'run', 0.5);
  assert.ok(ev.some(e => e.type === 'clear'));
  assert.ok(ev.some(e => e.type === 'level'));
  assert.ok(s.essence > 0);
  const u = E.undo(s);
  assert.equal(u.id, 'run');
  assert.deepEqual(s, before);
});
test('undoing every set of a day returns to the morning state', () => {
  const s = player(TRAINED);
  clearDays(s, 3);
  const morning = clone(s);
  E.addProgress(s, 'pushups', 20); E.addProgress(s, 'run', 5, { minutes: 30 }); E.addProgress(s, 'squats', 70);
  E.addProgress(s, 'situps', 50); E.addProgress(s, 'pushups', 40);
  assert.ok(E.today(s).cleared);
  while (E.undo(s));
  assert.deepEqual(s, morning);
});

// ---------- result tiers and the streak ----------
test('clear and near clear grow the streak, partial holds it', () => {
  const s = player();
  clearDay(s);
  let r = report(next(s));
  assert.equal(r.days[0].result, 'clear');
  assert.equal(s.streak, 1);
  doDay(s, 0.8);
  r = report(next(s));
  assert.equal(r.days[0].result, 'near');
  assert.equal(s.streak, 2);
  doDay(s, 0.5);
  r = report(next(s));
  assert.equal(r.days[0].result, 'partial');
  assert.equal(s.streak, 2);
  assert.equal(E.today(s).penalty, undefined);
});
test('three of four tasks done is a near clear', () => {
  const s = player();
  for (const id of ['pushups', 'situps', 'squats']) E.addProgress(s, id, E.today(s).targets[id]);
  assert.equal(E.score(E.today(s)), 0.75);
  assert.equal(E.resultOf(E.today(s)), 'near');
  assert.deepEqual(E.liveStreak(s), { n: 1, state: 'grown' });
});
test('a missed day never deletes XP, level or rank in normal mode: it issues a Penalty Quest', () => {
  const s = player();
  clearDays(s, 5);
  const xp = s.totalXp, level = s.level;
  const r = report(next(s)); // day 6 not touched
  assert.equal(r.days[0].result, 'missed');
  assert.equal(s.streak, 5, 'the streak holds for one day');
  assert.equal(s.totalXp, xp);
  assert.equal(s.level, level);
  assert.equal(E.today(s).penalty.type, 'plank');
  assert.deepEqual(E.liveStreak(s), { n: 5, state: 'risk' });
});
test('a weak effort (under 25%) also triggers a Penalty Quest and still pays its XP', () => {
  const s = player();
  E.addProgress(s, 'pushups', 5);
  assert.equal(E.resultOf(E.today(s)), 'weak');
  const r = report(next(s));
  assert.equal(r.days[0].result, 'weak');
  assert.ok(s.totalXp > 0);
  assert.ok(E.today(s).penalty);
});
test('clearing the Penalty Quest keeps the streak going', () => {
  const s = player();
  clearDays(s, 5);
  next(s);
  const ev = clearDay(s);
  assert.ok(E.penaltyDone(E.today(s)));
  assert.equal(E.liveStreak(s).n, 6);
  const r = report(next(s));
  assert.equal(r.days[0].penalty, 'cleared');
  assert.equal(s.streak, 6);
  assert.equal(s.penaltyClears, 1);
  assert.equal(r.broke, undefined);
  void ev;
});
test('the normal quest without the extra task does not clear a Penalty Quest', () => {
  const s = player();
  clearDays(s, 5);
  next(s);
  doDay(s, 1);
  assert.ok(E.today(s).cleared);
  assert.ok(!E.penaltyDone(E.today(s)));
  const r = report(next(s));
  assert.equal(r.days[0].penalty, 'failed');
  assert.deepEqual(r.broke, { lost: 5 });
  assert.equal(s.streak, 0);
  assert.equal(E.today(s).penalty, undefined, 'the day itself scored 100%, so no new penalty');
});
test('penalty extra tasks: plank scales with tier, then +20% on the weakest task', () => {
  const s = player(); // overall tier 1
  next(s);
  assert.deepEqual(E.today(s).penalty, { type: 'plank', need: 60, done: 0 });
  next(s);
  const p = E.today(s).penalty;
  assert.equal(p.type, 'extra');
  assert.equal(p.pct, 20);
  assert.equal(p.need, Math.ceil(E.today(s).targets[p.id] * 1.2));
  const k = player(TRAINED); // overall tier 4
  next(k);
  assert.equal(E.today(k).penalty.need, 240, 'the full 4-minute plank from tier 4');
  next(k);
  assert.equal(E.today(k).penalty.id, 'pushups', 'weakest task of a tier 4/4/4/6 player');
  assert.equal(E.today(k).penalty.need, 60);
});
test('the plank is logged as its own task', () => {
  const s = player();
  next(s);
  doDay(s, 1);
  E.addProgress(s, 'plank', 30);
  assert.ok(!E.penaltyDone(E.today(s)));
  const ev = E.addProgress(s, 'plank', 30);
  assert.ok(ev.some(e => e.type === 'penaltyCleared'));
  E.undo(s);
  assert.equal(E.today(s).penalty.done, 30);
});
test('milestones pay a chest and a title once', () => {
  const s = player();
  clearDays(s, 6);
  assert.ok(!s.titles.includes('seven'));
  const essence = s.essence;
  clearDay(s);
  const chest = E.today(s).chest.essence;
  const ev = next(s);
  assert.deepEqual(report(ev).milestones, [{ days: 7, essence: 50 }]);
  assert.equal(s.essence, essence + chest + 50);
  assert.ok(s.titles.includes('seven'));
  assert.ok(ev.some(e => e.type === 'title' && e.id === 'seven'));
});

// ---------- Hard mode ----------
test('Hard mode pays +20% on everything', () => {
  const s = player();
  E.setHard(s, true);
  clearDay(s);
  assert.equal(E.breakdown(s).total, 180);
  assert.equal(s.totalXp, 180);
});
test('switching Hard mode on mid-day reprices what is already logged', () => {
  const s = player();
  clearDay(s);
  assert.equal(s.totalXp, 150);
  E.setHard(s, true);
  assert.equal(s.totalXp, 180);
  E.setHard(s, false); // streak is 0, so it switches off at once
  assert.equal(s.hard, false);
  assert.equal(s.totalXp, 150);
});
test('Hard mode: a broken streak wipes the level bar and costs one level, never the rank', () => {
  const s = player(TRAINED);
  E.setHard(s, true);
  clearDays(s, 12);
  s.rank = 1;
  next(s); // missed
  assert.equal(E.today(s).penalty.need, 480, 'the penalty task is doubled');
  doDay(s, 0.5); // penalty not cleared
  const level = s.level, bar = s.xp, total = s.totalXp;
  assert.ok(level > 3 && bar > 0);
  const r = report(next(s));
  assert.equal(r.broke.lost, 12);
  assert.deepEqual(r.broke.hard, { levelFrom: level, xp: bar, levelTo: level - 1 });
  assert.equal(s.level, level - 1);
  assert.equal(s.xp, 0);
  assert.equal(s.totalXp, total, 'lifetime XP is a record and is not rewritten');
  assert.equal(s.streak, 0);
  assert.equal(s.rank, 1);
});
test('normal mode: the same broken streak costs no XP and no level', () => {
  const s = player(TRAINED);
  clearDays(s, 12);
  next(s);
  doDay(s, 0.5);
  const level = s.level, xp = s.xp, total = s.totalXp;
  const r = report(next(s));
  assert.equal(r.broke.lost, 12);
  assert.equal(r.broke.hard, undefined);
  assert.deepEqual([s.level, s.xp, s.totalXp], [level, xp, total]);
});
test('Hard mode cannot be switched off to dodge a penalty: it waits for the streak to end', () => {
  const s = player();
  E.setHard(s, true);
  clearDays(s, 4);
  const res = E.setHard(s, false);
  assert.equal(res.pending, true);
  assert.equal(s.hard, true);
  assert.equal(s.hardOffPending, true);
  next(s); // missed
  const lvl = s.level;
  const r = report(next(s)); // penalty missed too
  assert.equal(r.broke.hard.levelTo, lvl - 1);
  assert.equal(r.hardOff, true);
  assert.equal(s.hard, false);
});
test('a long absence in Hard mode costs exactly one level', () => {
  const s = player(TRAINED);
  E.setHard(s, true);
  clearDays(s, 10);
  const level = s.level;
  const r = report(next(s, 40));
  assert.equal(r.missed, 40);
  assert.equal(s.level, level - 1);
  assert.equal(s.streak, 0);
});

// ---------- rest tokens ----------
test('one rest token for 14 full clears in a row, and only one can be held', () => {
  const s = player();
  clearDays(s, 13);
  assert.equal(s.restTokens, 0);
  assert.equal(s.clearRun, 13);
  clearDay(s);
  const r = report(next(s));
  assert.equal(r.tokens, 1);
  assert.equal(s.restTokens, 1);
  clearDays(s, 20);
  assert.equal(s.restTokens, 1);
  assert.equal(s.clearRun, 0, 'the count stops while a token is held');
});
test('a near clear breaks the run toward a rest token', () => {
  const s = player();
  clearDays(s, 10);
  doDay(s, 0.8); next(s);
  assert.equal(s.clearRun, 0);
  clearDays(s, 13);
  assert.equal(s.restTokens, 0);
  clearDays(s, 1);
  assert.equal(s.restTokens, 1);
});
test('using a rest token freezes the streak for a day with no XP and no penalty', () => {
  const s = player();
  clearDays(s, 14);
  const xp = s.totalXp;
  assert.ok(E.restInfo(s).canUse);
  assert.ok(E.useRestToken(s).ok);
  assert.equal(E.today(s).kind, 'rest');
  assert.equal(E.addProgress(s, 'pushups', 10).length, 0);
  const r = report(next(s));
  assert.equal(r.days[0].result, 'rest');
  assert.equal(s.streak, 14);
  assert.equal(s.totalXp, xp);
  assert.equal(s.restTokens, 0);
  assert.equal(E.today(s).penalty, undefined);
  assert.equal(s.clearRun, 0, 'the count toward the next token restarts');
});
test('rest must be chosen before logging, cannot skip a Penalty Quest, and can be cancelled', () => {
  const s = player();
  clearDays(s, 14);
  E.addProgress(s, 'pushups', 1);
  assert.equal(E.useRestToken(s).ok, false);
  E.undo(s);
  assert.ok(E.useRestToken(s).ok);
  assert.ok(E.cancelRest(s).ok);
  assert.equal(E.today(s).kind, 'quest');
  assert.equal(s.restTokens, 1);
  next(s); // missed, so tomorrow is a Penalty Quest
  assert.equal(E.restInfo(s).canUse, false);
  assert.match(E.restInfo(s).why, /Penalty/);
});

// ---------- injured or sick mode ----------
test('injured or sick mode pauses the quest and the streak with no penalty', () => {
  const s = player();
  clearDays(s, 6);
  E.setPaused(s, true);
  const r = report(next(s, 10));
  assert.ok(r.days.every(d => d.result === 'paused'));
  assert.equal(r.missed, 0);
  assert.equal(s.streak, 6);
  assert.equal(E.addProgress(s, 'pushups', 5).length, 0);
  E.setPaused(s, false);
  assert.equal(E.today(s).penalty, undefined);
  clearDay(s); next(s);
  assert.equal(s.streak, 7);
});
test('a Penalty Quest waits out a sick pause instead of being dodged', () => {
  const s = player();
  clearDays(s, 3);
  next(s); // missed: today is a Penalty Quest
  assert.ok(E.today(s).penalty);
  E.setPaused(s, true);
  next(s, 3);
  assert.equal(s.streak, 3);
  assert.equal(E.today(s).penalty, undefined);
  E.setPaused(s, false);
  assert.ok(E.today(s).penalty, 'the penalty returns with the quest');
});

// ---------- targets ----------
test('5 clears in the last 7 days raise every target about 10%, once a week', () => {
  const s = player(TRAINED);
  for (let i = 0; i < 6; i++) { clearDay(s); assert.equal(report(next(s)).targets.length, 0); }
  clearDay(s);
  const r = report(next(s));
  assert.equal(r.targets[0].dir, 'up');
  assert.deepEqual(s.targets, { pushups: 55, situps: 55, squats: 77, run: 5 });
  assert.deepEqual(E.today(s).targets, s.targets);
  for (let i = 0; i < 6; i++) { clearDay(s); assert.equal(report(next(s)).targets.length, 0); }
  clearDay(s); next(s);
  assert.equal(s.targets.pushups, 61);
});
test('a target stops at each tier number on the way up and the tier goes up with it', () => {
  const s = player(TRAINED);
  s.targets = { pushups: 74, situps: 60, squats: 84, run: 5 };
  clearDays(s, 1); // today still uses the old snapshot
  const seen = [];
  for (let i = 0; i < 21; i++) { clearDay(s); const r = report(next(s)); if (r.targets.length) seen.push(r.targets[0]); }
  assert.deepEqual(seen[0].to, { pushups: 75, situps: 66, squats: 85, run: 5 });
  assert.deepEqual(seen[0].tierUps, [{ id: 'pushups', tier: 5 }, { id: 'squats', tier: 5 }]);
  assert.deepEqual(seen[1].to, { pushups: 83, situps: 73, squats: 94, run: 5 });
  assert.deepEqual(seen[2].to, { pushups: 91, situps: 75, squats: 100, run: 5 }, 'sit-ups stop at the tier 5 number');
});
test('two "too hard" answers in a week block the next increase', () => {
  const s = player(TRAINED);
  for (let i = 0; i < 7; i++) { clearDay(s); if (i < 2) E.setFelt(s, 'hard'); var r = report(next(s)); }
  assert.equal(r.targets[0].dir, 'held');
  assert.equal(s.targets.pushups, 50);
  for (let i = 0; i < 7; i++) { clearDay(s); r = report(next(s)); }
  assert.equal(r.targets[0].dir, 'up');
});
test('3 days under 50% in a week lower the targets by about 10%, never below tier 1', () => {
  const s = player(TRAINED);
  doDay(s, 0.3); assert.equal(report(next(s)).targets.length, 0);
  doDay(s, 0.3); assert.equal(report(next(s)).targets.length, 0);
  doDay(s, 0.3);
  const r = report(next(s));
  assert.equal(r.targets[0].dir, 'down');
  assert.deepEqual(s.targets, { pushups: 45, situps: 45, squats: 63, run: 4.5 });
  assert.equal(E.tierOf('pushups', 45), 3);
  const b = player(BEGINNER);
  next(b, 30);
  assert.deepEqual(b.targets, { pushups: 10, situps: 10, squats: 15, run: 1 });
});
test('a long break lowers the quest at most once a week', () => {
  const s = player(TRAINED);
  const r = report(next(s, 30));
  const downs = r.targets.filter(t => t.dir === 'down').length;
  assert.ok(downs >= 3 && downs <= 5, 'got ' + downs);
  assert.ok(s.targets.pushups >= 30 && s.targets.pushups < 50);
});

// ---------- ranks ----------
test('rank thresholds are E1 D10 C25 B45 A65 S85', () => {
  assert.deepEqual(E.RANKS.map(r => r.id + r.level), ['E1', 'D10', 'C25', 'B45', 'A65', 'S85']);
});
test('a rank needs its level and a passed trial', () => {
  const s = player(TRAINED);
  assert.equal(E.startTrial(s).ok, false);
  s.level = 10;
  const info = E.trialInfo(s);
  assert.ok(info.canStart);
  assert.equal(info.next.id, 'D');
  assert.ok(E.startTrial(s).ok);
  E.addProgress(s, 'pushups', 25); E.addProgress(s, 'situps', 25); E.addProgress(s, 'squats', 25);
  assert.equal(s.rank, 0);
  const ev = E.addProgress(s, 'run', 1.5);
  assert.ok(ev.some(e => e.type === 'rank' && e.rank === 'D'));
  assert.equal(s.rank, 1);
  E.undo(s);
  assert.equal(s.rank, 0, 'undo takes the rank back');
  E.addProgress(s, 'run', 1.5);
  assert.equal(s.rank, 1);
});
test('a failed trial costs nothing and can be retried after 3 days', () => {
  const s = player(BEGINNER);
  s.level = 10;
  E.startTrial(s);
  clearDay(s); // 10 / 10 / 15 / 1 km is below the D trial
  const xp = s.totalXp;
  const r = report(next(s));
  assert.equal(r.trialFailed, 'D');
  assert.equal(s.rank, 0);
  assert.equal(s.streak, 1);
  assert.equal(s.totalXp, xp);
  assert.equal(E.trialInfo(s).wait, 2);
  assert.equal(E.startTrial(s).ok, false);
  next(s, 2);
  assert.ok(E.trialInfo(s).canStart);
});
test('what was logged before the trial started still counts for it', () => {
  const s = player(TRAINED);
  s.level = 12;
  clearDay(s);
  const res = E.startTrial(s);
  assert.ok(res.ev.some(e => e.type === 'rank'));
  assert.equal(s.rank, 1);
});
test('S rank needs the full routine in one day, and unlocks Limit Breaker', () => {
  const s = player(TRAINED);
  s.level = 90; s.rank = 4;
  E.startTrial(s);
  clearDay(s); // 50/50/70/5 is not enough
  assert.equal(s.rank, 4);
  for (const id of ['pushups', 'situps', 'squats']) E.addProgress(s, id, 100 - E.today(s).progress[id]);
  assert.equal(s.rank, 5);
  assert.ok(s.titles.includes('limit'));
});

// ---------- stats ----------
test('stats come only from training: there is no way to add points', () => {
  const s = player(TRAINED);
  const st = E.stats(s);
  assert.deepEqual([st.STR, st.END, st.AGI], [16, 20, 24]);
  clearDay(s); // 50 push-ups + 70 squats = 120
  assert.equal(E.stats(s).STR, 16);
  next(s); clearDay(s); // 240
  assert.equal(E.stats(s).STR, 16);
  next(s);
  const ev = E.addProgress(s, 'pushups', 10); // 250
  assert.ok(ev.some(e => e.type === 'stat' && e.stat === 'STR'));
  assert.equal(E.stats(s).STR, 17);
  E.undo(s);
  assert.equal(E.stats(s).STR, 16);
});
test('END grows +1 per 200 sit-ups and +1 per 10 km', () => {
  const s = player(TRAINED);
  s.totals.situps = 199; s.totals.run = 9.5;
  const base = E.stats(s).END;
  E.addProgress(s, 'situps', 1);
  assert.equal(E.stats(s).END, base + 1);
  E.addProgress(s, 'run', 0.5);
  assert.equal(E.stats(s).END, base + 2);
});
test('AGI grows from pace: +1 per 5 s/km gained and +1 per 5 runs at target pace', () => {
  const s = player(TRAINED);
  const base = E.stats(s).AGI;
  E.addProgress(s, 'run', 5, { minutes: 30 }); // 6:00 per km
  assert.deepEqual(s.pace, { base: 360, best: 360 });
  assert.equal(s.paceRuns, 1);
  next(s);
  E.addProgress(s, 'run', 5, { minutes: 29 }); // 5:48 per km, 12 s faster
  assert.equal(s.pace.best, 348);
  assert.equal(E.stats(s).AGI, base + 2);
  E.undo(s);
  assert.deepEqual(s.pace, { base: 360, best: 360 });
  for (let i = 0; i < 4; i++) { next(s); E.addProgress(s, 'run', 5, { minutes: 31 }); }
  assert.equal(s.paceRuns, 5);
  assert.equal(E.stats(s).AGI, base + 1);
  next(s);
  E.addProgress(s, 'run', 5, { minutes: 50 }); // far off pace
  assert.equal(s.paceRuns, 5);
  E.addProgress(s, 'run', 0.5, { minutes: 1 }); // too short to count
  E.addProgress(s, 'run', 2, { minutes: 0.5 }); // not a believable pace
  assert.equal(s.pace.best, 360);
});
test('the 12-minute test sets a first pace', () => {
  const s = player({ pushups: 10, run12: 2 });
  assert.deepEqual(s.pace, { base: 360, best: 360 });
  E.retest(s, { pushups: 10, run12: 2.2 });
  assert.equal(s.pace.best, 327);
  assert.equal(E.stats(s).AGI, s.statBase.AGI + 6);
});

// ---------- Hunter Hall ----------
test('Hunter Hall opens at C rank with a 30-day streak, locks after 14 idle days, reopens after 7 clears', () => {
  const s = player(TRAINED);
  clearDays(s, 31);
  assert.equal(s.hall.state, 'sealed');
  assert.equal(E.hallInfo(s).streakOk, true);
  assert.equal(E.hallInfo(s).rankOk, false);
  s.rank = 2;
  clearDay(s);
  assert.equal(report(next(s)).hall, 'opened');
  assert.equal(s.hall.state, 'open');
  const r = report(next(s, 14));
  assert.equal(r.hall, 'locked');
  clearDays(s, 6);
  assert.equal(s.hall.state, 'locked');
  clearDay(s);
  assert.equal(report(next(s)).hall, 'reopened');
});
test('sick days do not lock the Hall', () => {
  const s = player(TRAINED);
  s.rank = 2;
  clearDays(s, 31);
  assert.equal(s.hall.state, 'open');
  E.setPaused(s, true);
  next(s, 40);
  assert.equal(s.hall.state, 'open');
});

// ---------- skills ----------
test('skill slots open at D, C and A rank, and skills unlock by level', () => {
  const s = player(TRAINED);
  s.level = 30;
  assert.equal(E.equipSkill(s, 'secondWind').ok, false, 'no slot at E rank');
  s.rank = 1;
  assert.ok(E.equipSkill(s, 'secondWind').ok);
  assert.equal(E.equipSkill(s, 'earlyRiser').ok, false, 'one slot at D rank');
  s.rank = 2;
  assert.ok(E.equipSkill(s, 'earlyRiser').ok);
  assert.equal(E.equipSkill(s, 'deepRest').ok, false);
  assert.equal(E.equipSkill(s, 'instinct').ok, false);
  assert.deepEqual(E.SKILL_SLOTS, [0, 1, 2, 2, 3, 3]);
});
test('Second Wind saves the streak from one failed Penalty Quest a month', () => {
  const s = player(TRAINED);
  s.level = 10; s.rank = 1;
  E.equipSkill(s, 'secondWind');
  clearDays(s, 5);
  next(s); // missed
  let r = report(next(s)); // penalty missed too
  assert.equal(r.secondWind, true);
  assert.equal(s.streak, 5);
  r = report(next(s)); // and again, inside the month
  assert.equal(r.broke.lost, 5);
  assert.equal(s.streak, 0);
});
test('Early Riser pays +10% for tasks finished before 9 AM', () => {
  const s = player();
  s.level = 15; s.rank = 1;
  E.equipSkill(s, 'earlyRiser');
  E.addProgress(s, 'pushups', 10, { hour: 7.5 });
  E.addProgress(s, 'situps', 10, { hour: 12 });
  assert.equal(E.breakdown(s).early, 2.5);
  E.undo(s); E.undo(s);
  assert.equal(E.today(s).early, undefined);
});
test('Overdrive pays overflow at full rate, once a week', () => {
  const s = player();
  s.level = 30; s.rank = 1;
  E.equipSkill(s, 'overdrive');
  E.addProgress(s, 'pushups', 12);
  assert.equal(s.totalXp, 28); // 25 + 2.5 rounded
  assert.ok(E.activateOverdrive(s).ok);
  assert.equal(s.totalXp, 30);
  next(s);
  assert.equal(E.activateOverdrive(s).ok, false);
  assert.equal(E.overdriveInfo(s).wait, 6);
  next(s, 6);
  assert.ok(E.overdriveInfo(s).canUse);
});
test('Split Focus counts one task double toward its stat', () => {
  const s = player(TRAINED);
  s.level = 20; s.rank = 1;
  E.equipSkill(s, 'splitFocus');
  E.setFocus(s, 'pushups');
  E.addProgress(s, 'pushups', 125);
  assert.equal(E.stats(s).STR, s.statBase.STR + 1);
  next(s);
  assert.equal(s.focus.pushups, 125);
  assert.equal(E.stats(s).STR, s.statBase.STR + 1);
});
test('Deep Rest holds 2 tokens and Apex Pace lifts the streak cap to +60%', () => {
  const s = player();
  s.level = 70; s.rank = 2;
  E.equipSkill(s, 'deepRest'); E.equipSkill(s, 'apexPace');
  clearDays(s, 28);
  assert.equal(s.restTokens, 2);
  clearDays(s, 14);
  assert.equal(s.restTokens, 2);
  assert.equal(E.streakBonus(s, 40), 0.6);
});

// ---------- cosmetics ----------
test('chests pay Essence on every clear, and the shop sells cosmetics for it', () => {
  const s = player(TRAINED);
  clearDay(s);
  assert.equal(E.today(s).chest.essence, 10 + 5 * 3);
  assert.equal(E.buyItem(s, 'theme-crimson').ok, false);
  s.essence = 1000;
  assert.ok(E.buyItem(s, 'theme-crimson').ok);
  assert.equal(s.essence, 700);
  assert.ok(E.equipItem(s, 'theme', 'theme-crimson').ok);
  assert.equal(E.equipItem(s, 'frame', 'theme-crimson').ok, false);
  assert.equal(E.buyItem(s, 'frame-circuit').ok, false, 'card frames need B rank');
  s.rank = 3;
  assert.ok(E.buyItem(s, 'frame-circuit').ok);
});
test('chest contents are fixed by the day, so undo and redo cannot reroll them', () => {
  for (let seed = 1; seed < 40; seed++) {
    const s = player(TRAINED, seed);
    clearDay(s);
    const first = clone(E.today(s).chest);
    E.undo(s);
    assert.equal(s.items.length, 0);
    E.addProgress(s, E.today(s).log.length ? 'run' : 'run', 5);
    clearDay(s);
    assert.deepEqual(E.today(s).chest, first);
  }
});
test('aura follows the rank, and colours can be chosen from D rank', () => {
  const s = player();
  assert.equal(E.auraOf(s), 0);
  assert.equal(E.setAura(s, 0).ok, false);
  s.rank = 3;
  assert.equal(E.auraOf(s), 3);
  assert.ok(E.setAura(s, 1).ok);
  assert.equal(E.auraOf(s), 1);
  assert.equal(E.setAura(s, 5).ok, false);
});

// ---------- titles ----------
test('titles from the design doc unlock on their conditions', () => {
  const s = player(ELITE);
  assert.deepEqual(s.titles, ['awakened']);
  const ev = E.addProgress(s, 'pushups', 100);
  assert.ok(ev.some(e => e.type === 'title' && e.id === 'hundredfold'));
  E.undo(s);
  assert.ok(!s.titles.includes('hundredfold'), 'a title earned by an undone set is taken back');
  s.totals.run = 99;
  E.addProgress(s, 'run', 1);
  assert.ok(s.titles.includes('road'));
  s.penaltyClears = 5; s.best = 365; s.hardClears = 30;
  next(s);
  for (const id of ['brink', 'seven', 'iron', 'unbroken', 'year', 'oath', 'edge']) assert.ok(s.titles.includes(id), id);
});

// ---------- re-test ----------
test('a re-test jumps tiers, keeps weekly progress inside a tier, and never lowers stats', () => {
  const s = player(TRAINED);
  s.targets.pushups = 61;
  next(s);
  const res = E.retest(s, { pushups: 28, situps: 50, squats: 20, runMax: 5 });
  assert.equal(s.targets.pushups, 61, 'same tier keeps its progress');
  assert.equal(s.targets.situps, 100, 'higher result jumps');
  assert.equal(s.targets.squats, 30, 'lower result steps down');
  assert.ok(res.today);
  assert.deepEqual(E.today(s).targets, s.targets);
  assert.equal(s.statBase.STR, 16);
  assert.equal(E.retestDue(s), false);
  next(s, 28);
  assert.equal(E.retestDue(s), true);
});
test('a re-test after logging starts tomorrow', () => {
  const s = player(TRAINED);
  E.addProgress(s, 'pushups', 10);
  const res = E.retest(s, ELITE);
  assert.equal(res.today, false);
  assert.equal(E.today(s).targets.pushups, 50);
  next(s);
  assert.equal(E.today(s).targets.pushups, 100);
});

// ---------- time ----------
test('the game day rolls over at 4 AM, so a late-night session counts for the day before', () => {
  assert.equal(E.gameDay(new Date(2026, 10, 27, 1, 30)), '2026-11-26');
  assert.equal(E.gameDay(new Date(2026, 10, 27, 3, 59)), '2026-11-26');
  assert.equal(E.gameDay(new Date(2026, 10, 27, 4, 0)), '2026-11-27');
  const r = E.nextReset(new Date(2026, 10, 27, 1, 30));
  assert.deepEqual([r.getDate(), r.getHours()], [27, 4]);
  const r2 = E.nextReset(new Date(2026, 10, 27, 9, 0));
  assert.deepEqual([r2.getDate(), r2.getHours()], [28, 4]);
});
test('a clock that moves backwards never punishes and never overwrites a day', () => {
  const s = player();
  clearDays(s, 2);
  E.addProgress(s, 'pushups', 5);
  const before = clone(s);
  assert.deepEqual(E.ensureDay(s, E.addDays(s.lastDay, -3)), []);
  assert.deepEqual(E.ensureDay(s, s.lastDay), []);
  assert.deepEqual(s, before);
});
test('old day records are trimmed and settled days drop their undo log', () => {
  const s = player();
  clearDays(s, 3);
  assert.equal(s.days[START].log, undefined);
  next(s, 500);
  assert.ok(Object.keys(s.days).length <= E.TUNING.keepDays);
});

// ---------- the day of the Awakening Test ----------
test('nothing logged on the day of the Awakening Test brings no Penalty Quest', () => {
  const s = fresh(TRAINED);
  assert.equal(s.graceDay, START);
  const r = report(next(s));
  assert.equal(r.days[0].result, 'missed');
  assert.equal(r.days[0].grace, true);
  assert.equal(r.penalty, null);
  assert.equal(s.penaltyOwed, false);
  assert.equal(E.today(s).penalty, undefined);
  assert.equal(s.penaltyCount, 0);
});
test('a weak effort on that day brings no penalty either, and its XP is kept', () => {
  const s = fresh();
  E.addProgress(s, 'pushups', 2);
  const r = report(next(s));
  assert.equal(r.days[0].result, 'weak');
  assert.equal(r.days[0].grace, true);
  assert.ok(s.totalXp > 0);
  assert.equal(E.today(s).penalty, undefined);
});
test('clearing on that day counts like any other clear', () => {
  const s = fresh();
  clearDay(s);
  const r = report(next(s));
  assert.equal(r.days[0].result, 'clear');
  assert.equal(r.days[0].grace, undefined);
  assert.equal(s.streak, 1);
  assert.equal(s.clears, 1);
});
test('from the second day on a missed day brings the Penalty Quest', () => {
  const s = fresh();
  next(s);
  const r = report(next(s));
  assert.equal(r.days[0].grace, undefined);
  assert.equal(r.penalty.type, 'plank');
  const late = fresh();
  const all = report(next(late, 3)); // away for three days: only the first one is forgiven
  assert.deepEqual(all.days.map(d => !!d.grace), [true, false, false]);
  assert.ok(E.today(late).penalty);
});
test('that day does not count toward lowering the quest', () => {
  const s = fresh(TRAINED);
  next(s);                                   // the awakening day, nothing logged
  doDay(s, 0.3); assert.equal(report(next(s)).targets.length, 0);
  doDay(s, 0.3); assert.equal(report(next(s)).targets.length, 0, 'two weak days after the awakening day are not three');
  doDay(s, 0.3);
  assert.equal(report(next(s)).targets[0].dir, 'down');
});
test('a re-test does not hand out a second free day', () => {
  const s = fresh();
  clearDays(s, 3);
  E.retest(s, TRAINED);
  assert.equal(s.graceDay, START);
  next(s);
  assert.ok(E.today(s).penalty, 'the day of a re-test is an ordinary day');
});
test('the day a first-prototype save is carried over is forgiven too', () => {
  const s = E.migrateV1({ v: 1, name: 'Old', streak: 3, best: 3, totalXp: 100, days: {} }, '', TRAINED, START, 9);
  assert.equal(s.graceDay, START);
  next(s);
  assert.equal(E.today(s).penalty, undefined);
  assert.equal(s.streak, 3, 'the streak holds');
});

// ---------- coming from the first prototype ----------
test('a save from the first prototype keeps its name, totals, XP, streak and history', () => {
  const old = {
    v: 1, name: 'Kai', created: '2026-11-20', level: 3, xp: 40, totalXp: 400, streak: 2, best: 4, clears: 3,
    totals: { pushups: 120, situps: 90, squats: 100, run: 6.5 }, test: { pushups: 28, situps: 20, squats: 30, run: 5 },
    days: {
      '2026-11-25': { targets: { pushups: 55, situps: 40, squats: 60, run: 5 }, progress: { pushups: 55, situps: 40, squats: 60, run: 5 }, cleared: true, xp: 300 },
      [START]: { targets: { pushups: 57, situps: 41, squats: 62, run: 5 }, progress: { pushups: 20, situps: 0, squats: 0, run: 0 }, cleared: false, xp: 20 },
    },
  };
  const s = E.migrateV1(old, '', TRAINED, START, 5);
  assert.equal(s.name, 'Kai');
  assert.equal(s.created, '2026-11-20');
  assert.equal(s.totals.pushups, 120);
  assert.equal(s.totalXp, 400);
  assert.equal(s.level, 4);
  assert.equal(s.streak, 2);
  assert.equal(s.days['2026-11-25'].result, 'clear');
  assert.equal(E.today(s).progress.pushups, 20);
  const xp = s.totalXp;
  E.addProgress(s, 'pushups', 30);
  assert.equal(s.totalXp - xp, Math.round(40 * 1.04) - Math.round(16 * 1.04), 'only the new reps are paid');
  assert.doesNotThrow(() => E.migrateV1({}, 'X', {}, START, 1));
  assert.doesNotThrow(() => E.migrateV1(null, 'X', null, START, 1));
});

// ---------- a random walk through every action ----------
test('fuzz: undo is exact and the state stays sane through 20,000 random actions', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  for (let run = 0; run < 20; run++) {
    const s = E.newPlayer('Fuzz', pick([BEGINNER, TRAINED, ELITE]), START, run + 1);
    for (let i = 0; i < 1000; i++) {
      const r = rnd();
      if (r < 0.5) {
        const id = pick(E.QUEST_IDS.concat('plank'));
        const amt = id === 'run' ? pick([0.5, 1, 2.5, 5]) : pick([1, 5, 10, 30, 100]);
        const before = clone(s);
        const ev = E.addProgress(s, id, amt, { hour: rnd() * 24, minutes: rnd() < 0.5 ? amt * (4 + rnd() * 4) : undefined });
        if (ev.length && rnd() < 0.3) { E.undo(s); assert.deepEqual(s, before); }
      } else if (r < 0.58) E.undo(s);
      else if (r < 0.8) E.ensureDay(s, E.addDays(s.lastDay, rnd() < 0.9 ? 1 : 1 + Math.floor(rnd() * 12)));
      else if (r < 0.83) E.setHard(s, rnd() < 0.5);
      else if (r < 0.86) E.setPaused(s, rnd() < 0.3);
      else if (r < 0.89) E.useRestToken(s);
      else if (r < 0.9) E.cancelRest(s);
      else if (r < 0.92) E.startTrial(s);
      else if (r < 0.94) { const k = pick(E.SKILLS).id; if (rnd() < 0.7) E.equipSkill(s, k); else E.unequipSkill(s, k); }
      else if (r < 0.95) E.activateOverdrive(s);
      else if (r < 0.96) E.setFocus(s, pick(E.QUEST_IDS));
      else if (r < 0.97) E.setFelt(s, pick(['easy', 'right', 'hard']));
      else if (r < 0.98) { const it = pick(E.ITEMS); E.buyItem(s, it.id); E.equipItem(s, it.kind, it.id); }
      else if (r < 0.99) E.retest(s, pick([BEGINNER, TRAINED, ELITE]));
      else E.setAura(s, Math.floor(rnd() * 6));
      const day = E.today(s);
      assert.ok(day, 'today exists');
      assert.ok(Number.isInteger(s.level) && s.level >= 1 && s.level <= 100, 'level ' + s.level);
      assert.ok(Number.isInteger(s.xp) && s.xp >= 0, 'xp ' + s.xp);
      assert.ok(s.level === 100 || s.xp < E.xpForNext(s.level), 'bar overflow');
      assert.ok(s.streak >= 0 && s.best >= s.streak);
      assert.ok(s.essence >= 0 && Number.isInteger(s.essence));
      assert.ok(s.restTokens >= 0 && s.restTokens <= 2);
      assert.ok(s.rank >= 0 && s.rank <= 5);
      assert.ok(s.skills.length <= E.skillSlots(s));
      assert.equal(day.xp, E.breakdown(s).total, 'today is always priced by the current rules');
      for (const id of E.QUEST_IDS) {
        assert.ok(s.targets[id] >= E.TIERS[0][id] && s.targets[id] <= E.TIERS[5][id], id + ' target ' + s.targets[id]);
        assert.ok(day.progress[id] >= 0);
      }
      const st = E.stats(s);
      assert.ok(st.STR >= s.statBase.STR && st.END >= s.statBase.END && st.AGI >= s.statBase.AGI);
      assert.ok(JSON.stringify(s).length < 200000, 'save stays small');
    }
  }
});

console.log(passed + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('\nFAIL ' + f.name + '\n' + (f.err && f.err.stack || f.err));
process.exit(failures.length ? 1 : 0);
