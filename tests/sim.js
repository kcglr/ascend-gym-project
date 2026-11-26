// Simulates players through the engine to check the pace of progress. Run: node tests/sim.js
const E = require('../engine.js');

const START = '2026-11-26';
const PROFILES = [
  { name: 'Tier 1 beginner, clears every day', test: { pushups: 3, situps: 5, squats: 8, run12: 0.9 }, plan: () => 1 },
  { name: 'Trained start (28 push-ups, 5 km), clears every day', test: { pushups: 28, situps: 30, squats: 40, runMax: 5 }, plan: () => 1 },
  { name: 'Already at the full routine, clears every day', test: { pushups: 60, situps: 60, squats: 70, runMax: 10 }, plan: () => 1 },
  { name: 'Tier 1 beginner, clears 5 days a week, 80% on the other 2', test: { pushups: 3, situps: 5, squats: 8, run12: 0.9 }, plan: d => (d % 7 < 5 ? 1 : 0.8) },
  { name: 'Tier 1 beginner, clears 5 days a week, skips the other 2', test: { pushups: 3, situps: 5, squats: 8, run12: 0.9 }, plan: d => (d % 7 < 5 ? 1 : 0) },
  { name: 'Trained start in Hard mode, clears every day', test: { pushups: 28, situps: 30, squats: 40, runMax: 5 }, plan: () => 1, hard: true },
];

function logDay(s, frac) {
  const day = E.today(s);
  if (!E.canLog(s) || frac <= 0) return;
  for (const id of E.QUEST_IDS) {
    const want = id === 'run' ? Math.round(day.targets[id] * frac * 100) / 100 : Math.ceil(day.targets[id] * frac);
    const left = Math.round((want - day.progress[id]) * 100) / 100;
    if (left > 0) E.addProgress(s, id, left);
  }
  const p = day.penalty;
  if (frac >= 1 && p) {
    if (p.type === 'plank') E.addProgress(s, 'plank', p.need - p.done);
    else E.addProgress(s, p.id, Math.round((p.need - day.progress[p.id]) * 100) / 100);
  }
}

function run(profile, days) {
  const s = E.newPlayer('Sim', profile.test, START, 3);
  if (profile.hard) E.setHard(s, true);
  const marks = { level: {}, rank: {}, full: null };
  const levels = [5, 10, 25, 45, 65, 85, 100];
  for (let d = 1; d <= days; d++) {
    // Take the Rank Trial as soon as the level allows and the day's own quest already covers it.
    const info = E.trialInfo(s);
    if (info.canStart && E.QUEST_IDS.every(id => E.today(s).targets[id] >= info.next.trial[id])) E.startTrial(s);
    logDay(s, profile.plan(d - 1));
    for (const L of levels) if (s.level >= L && !marks.level[L]) marks.level[L] = d;
    const rank = E.RANKS[s.rank].id;
    if (!marks.rank[rank]) marks.rank[rank] = d;
    if (!marks.full && E.isFullRoutine(s.targets)) marks.full = d;
    E.ensureDay(s, E.addDays(s.lastDay, 1));
  }
  return { s, marks };
}

const months = d => (d ? (d / 30.44).toFixed(1) + ' mo' : 'not reached');
for (const p of PROFILES) {
  const { s, marks } = run(p, 800);
  console.log('\n' + p.name);
  console.log('  start targets      ' + JSON.stringify(E.targetsFor(E.placeTest(p.test))));
  console.log('  full routine       day ' + marks.full + ' (' + months(marks.full) + ')');
  console.log('  levels             ' + Object.entries(marks.level).map(([l, d]) => 'L' + l + ': day ' + d).join(', '));
  console.log('  ranks (with trial) ' + Object.entries(marks.rank).map(([r, d]) => r + ': day ' + d).join(', '));
  console.log('  S-rank level 85    ' + months(marks.level[85]) + ', level 100 ' + months(marks.level[100]));
  console.log('  after 800 days     level ' + s.level + ', streak ' + s.streak + ', best ' + s.best + ', essence ' + s.essence + ', tokens ' + s.restTokens + ', STR/END/AGI ' + [E.stats(s).STR, E.stats(s).END, E.stats(s).AGI].join('/'));
}
