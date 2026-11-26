# Daily Quest System (prototype, version 2, "Abyss System" look)

A phone-sized web prototype of a gamified daily workout tracker. The quest is push-ups, sit-ups,
squats and a run, placed by a fitness test and ramping toward 100 / 100 / 100 / 5 km. The rules
follow the design doc "Daily Quest: Leveling & Rewards Design" (26 Nov 2026). The look was rebuilt
on 26 Nov 2026 in the "Abyss System" style: dark neon system windows, steel filigree, cyan and
violet glow, with painted art made for this app.

## Files

| File | What it is |
| --- | --- |
| `engine.js` | Every game rule. Pure logic: no DOM, no storage, no clock. Takes the player state (plain JSON) and returns events. Meant to move into the iOS app as it is. The redesign did not touch it. |
| `app.src.html` | The page shell: title, font link, the fixed layers (backdrop, tab bar, window layer, toasts, spark canvas) and three placeholders, `/*CSS*/`, `/*ENGINE*/` and `/*UI*/`. |
| `ui.css` | The whole look: colour tokens, skins, frames, bars, buttons, every screen and every animation. |
| `ui.js` | Storage, cloud save, screens, windows and actions. The storage and cloud save part is unchanged from before the redesign. |
| `assets/` | 17 WebP pictures (about 810 KB) and `manifest.json`, which names them and gives the icon sheet's layout. Published beside the page. |
| `art/` | `src/` holds the masters as they came from the image model, `samples/` the three style samples, and `process.py` cuts the masters into `assets/`. |
| `build.js` | `node build.js` inlines `ui.css`, `engine.js` and `ui.js` into `index.html` and stops if a picture or an icon the page asks for does not exist. |
| `index.html` | The built page. This is what gets published, together with the pictures in `assets/`. |
| `tests/engine.test.js` | 74 rule tests. `node tests/engine.test.js` |
| `tests/sim.js` | Plays up to 800 days for several player types and prints the pace. `node tests/sim.js` |
| `tests/ui.test.js` | 27 checks that drive the built page in a phone-sized headless browser, including two devices sharing a stand-in cloud, reduced motion, and every picture loading. `node build.js && node tests/ui.test.js` (needs Playwright with Chromium). |
| `tests/gallery.js` | Takes pictures of every screen and reward moment for looking at the design. `node build.js && node tests/gallery.js [scene ...] [--out dir] [--scale 2] [--width 400]` |
| `tests/serve.js` | The small server both use: the built page inside the wrapper the Artifact host adds, with `assets/` beside it. |

After any change to `engine.js`, `ui.css`, `ui.js` or `app.src.html`, run `node build.js`, then both
test files, then publish `index.html` with every `assets/*.webp` at the same relative path
(`assets/<name>.webp`). The page keeps its `db` and `user` capabilities.

## The look

**Strategies taken from polished Chinese mobile games** (the strategies, not anyone's art):

- Depth in layers: a painted backdrop, drifting motes, framed glass panels, painted figures that
  break out of their frames, and a spark layer on top.
- Ornate frames instead of plain boxes: chamfered corners, a gradient metal edge, corner wedges.
- Rank crests that grow with the tier: E is a bare shield, C grows wings, S has a crown and halo.
- One glossy primary button per screen with a light sweep, quiet secondary buttons.
- A daily activity track: the score bar has markers at 25% (no penalty) and 75% (streak +1) and a
  chest at the end.
- Reward moments with a reveal: the chest is tapped open and the loot counts up, a level-up bursts,
  a rank-up cracks the old crest and slams the new one in.
- Stamps on finished tasks, red dots on tabs that have something to do, currency pills in the status strip.

**How it is built**

- Colours are tokens on `:root` as bare RGB triples (`--g` glow, `--v` violet, `--ln` line, `--p1`
  and `--p2` panel, `--ink`), so `rgb(var(--g) / .4)` works anywhere. The four shop themes re-set
  the tokens under `:root[data-skin]` and turn the painted scenes with `--hue`.
- A mood class re-colours a whole subtree: `.gold`, `.warn`, `.ok`. Aura classes `.aura-0` to
  `.aura-5` set `--a` and `--a2` for crest glow, hero aura and the licence card.
- Every framed thing shares one recipe at the top of `ui.css`: `::before` is the edge, `::after`
  the glass, both cut by one chamfer polygon from `--c`. A new framed component only joins that
  selector list and sets `--c`, `--edge` and `--fill`.
- Icons are one sprite (`assets/glyphs.webp`, 5 by 4 cells) used as a CSS mask, so they take the
  text colour. `ic('name')` in `ui.js` picks the cell; the names are the `GLYPHS` list, which has
  to match `manifest.json`. Painted objects are plain images through `ob('name')`.
- The screen is redrawn after every tap. Looping animations stay in step through `--now`, bars and
  rings start from their last value (`fill()`, `moved()`), and one-shot effects fire only when a
  value really changed (`changed()`).
- Sparks are drawn on one fixed canvas (`burst()`, `burstAt()`), in the colours of the current skin.
- With "reduce motion" switched on, every animation is cut to nothing, numbers do not count up and
  no sparks are drawn. Everything still shows.

**Art.** All of it was generated for this app with the Higgsfield connector (model
`gpt_image_2_6`, the backdrop with `z_image`), about 12.4 credits in total. Prompts describe traits
and never name a game, a show or an artist. Sheets were generated on black and cut out by
`art/process.py`, which also un-multiplies the glow so edges stay clean on any colour. To change
a picture, replace its master in `art/src/`, run `python3 art/process.py`, then `node build.js`.

**Changes to how the screens work**

- The quest list shows the buttons of one task at a time. It opens the first unfinished task, moves
  on when a task is done, and a tap on any row opens that one.
- After a clear the reward waits in a chest: "Open the chest" shows the Essence, the XP rows and the
  "how did it feel" question.
- The tab bar has icons, and a red dot when a Rank Trial can start, a skill slot is free or a
  re-test is due.

## Rules in this build

All numbers live in the tables at the top of `engine.js` (`TIERS`, `PLACEMENT`, `RANKS`, `TUNING`).

- **Awakening Test.** Most push-ups in one set, sit-ups and squats in 60 seconds, distance in
  12 minutes and the longest run without stopping. Each task is placed in one of six tiers on its
  own. A re-test is suggested every 28 days and can be taken at any time from System.
- **Ramp.** After 5 clears in a week every target grows about 10%, at most once a week, stopping at
  each tier's number. Three days under 50% in a week step the targets down. Two "too hard" answers
  in a week hold the next increase.
- **XP.** 25 per task times the tier multiplier (1.0 to 2.0), +50 for a full clear, work from 100%
  to 120% at half rate, +2% per streak day up to +50%. Today's XP is always recomputed from what is
  logged, so undo can never drift.
- **Levels and ranks.** Level N needs `100 + 10 * N^1.2` XP, up to level 100. Ranks E, D, C, B, A, S
  need level 1, 10, 25, 45, 65, 85 and a one-day Rank Trial. A failed trial costs a 3-day wait.
- **Streak.** A clear, or 75% and more, grows it. 25% to 75% holds it. Under 25% brings a Penalty
  Quest the next day (the normal quest plus a plank, or +20% on the weakest task). Only a failed
  Penalty Quest breaks the streak. The day of the Awakening Test never brings a penalty.
- **Hard mode.** Optional. All XP +20%, penalties doubled, and a broken streak wipes the XP in the
  level bar and costs one level. Rank is never lost. Switching it off waits until the streak ends.
- **Rest tokens.** One per 14 clears in a row, 1 held at most (2 with the Deep Rest skill). A rest
  day freezes the streak and has to be chosen before anything is logged.
- **Injured or sick mode.** Pauses the quest and the streak with no penalty for as long as needed.
- **Stats.** Only from real training: STR from lifetime push-ups and squats, END from sit-ups and
  kilometres, AGI from a faster best pace and runs near that pace.
- **Rewards.** Titles, a profile card with rank emblem, aura and title, skills (1 slot at D rank,
  2 at C, 3 at A), Essence from clear chests and streak milestones, a small shop, and Hunter Hall
  (opens at C rank with a 30-day best streak).
- **Day reset.** 4:00 AM local time. A session at 1 AM still counts for the day before.

### Guesses that need play-testing

Marked `GUESS` in `engine.js`. The design doc leaves these open or gives only an example.

- Sit-up and squat thresholds for the 60-second test, and placing the run by the longest nonstop run.
- "Target pace" for Agility means within 15% of your best pace.
- Starting stats come from the test tiers, so a fit beginner does not start at zero.
- Essence amounts (chest 10 + 5 per tier, milestones 50 / 150 / 400 / 1000) and shop prices
  (themes 300, card frames 600 / 900 / 1200 from B rank).
- Extra titles: Mountain Arms, Deep Lungs, Tailwind (stat-gated), Oathbound and Edge Walker (Hard mode).
- The Penalty Quest alternates between the plank and +20% on the weakest task.
- The day of the Awakening Test (or of carrying over a first-prototype save) is forgiven: under 25%
  on that day brings no Penalty Quest and does not count toward lowering the quest. The doc calls
  the test "the first quest", and someone who sets up late in the evening should not wake up to a penalty.

### Simulated pace (`node tests/sim.js`)

| Player | Full routine | S rank | Level 100 |
| --- | --- | --- | --- |
| Tier 1 beginner, clears every day | month 6.0 | 9.2 months | 12.3 months |
| 28 push-ups and a 5 km run at the start, clears every day | month 1.9 | 7.9 months | 11.0 months |
| The same in Hard mode | month 1.9 | 6.7 months | 9.3 months |
| Beginner, clears 5 days a week, 80% on the other two | month 6.0 | 10.1 months | 13.6 months |
| Beginner, clears 5 days a week, skips the other two | month 6.0 | 16.8 months | 23.1 months |

## Saving

The page plays from a copy in the browser and, when the page is opened inside Claude, mirrors it to
a private cloud save so progress follows the person to other devices.

**Browser storage keys**

- `dailyquest.v2`: the player state, plus `rev`, `savedAt` and `debugOffset` added by the UI.
- `dailyquest.v2.meta`: `{ device, dead[] }`. `dead` lists erased players.
- `dailyquest.v2.pretest`: the real save, set aside while the test clock runs.
- `dailyquest.v2.stash`: the copy that lost the last sync, kept 30 days and restorable from System.
- `dailyquest.v1`, `dailyquest.v1.done`: a save from the first prototype and its "carried over" mark.

**Cloud save** (Artifact capabilities `db` and `user`, declared as `{ db: {}, user: {} }` at publish)

- One document per person at `data/users/<id>/save`, which is private to that person.
- Body: `{ v, sid, rev, savedAt, device, dead, xp, json }` where `json` is the whole state as a
  string, or `{ v, erased: true, dead, savedAt, device }` after "Erase all progress".
- Same player (`sid`): the higher `rev` wins, then the later `savedAt` from another device.
  Different players: one that was erased loses, otherwise more XP wins, then the later save.
- Writes are queued: one write per pause in the tapping (1.8 s, at most 6 s), one at a time, sent
  at once when the page is hidden, retried further apart when a write fails.
- On the first visit of a day, or with nothing saved in the browser, the page waits up to 3.5 s for
  the cloud copy before it scores the day, so a stale device does not hand out a wrong penalty.
- The whole save moves as one piece. Two devices used offline at the same time do not merge: the
  higher revision wins and the other copy goes to the stash on its device.
- State size is about 130 KB after 400 kept days, under the 256 KiB document limit.
- Without the capabilities (a saved file, a plain browser tab) the page uses browser storage only
  and says so on the System screen.

**Test clock.** System has "Skip to tomorrow" for trying penalties and reports. It is a sandbox: the
real save is set aside, nothing is sent to the cloud, and "Back to today" restores it.

## Not in this build

Weekly raid quests, endless mode after S rank, the Hunter's Instinct skill (shown as coming later),
title effects, sounds, sharing the card as an image, other hunters in Hunter Hall, GPS runs,
Apple Health, notifications and camera rep counting. The last four need the native app, and the
Hall needs accounts and a server.

## Path to iOS

`engine.js` has no browser dependencies, so it can run unchanged in React Native (Expo) with the
same JSON state in AsyncStorage or SQLite. The screens are rebuilt as native components, and the
native app adds what the web cannot do: reminders, HealthKit or GPS for the run, haptics. SwiftUI is
the alternative for an iOS-only app with deep Apple Watch support; the engine is then ported to Swift.

The art moves over as it is: `assets/` is plain WebP with transparency plus `manifest.json`, and
the pictures are large enough for 3x screens at the sizes used here (crests 384 px, hunter 1024 px tall).
The icon sheet is white on transparent, so `tintColor` colours it. The frames are CSS here; in
React Native they become an SVG path or a small 9-slice image per frame, with the same chamfer and
edge colours taken from the tokens at the top of `ui.css`. The reward animations are short enough
to rebuild with Reanimated, or to replace with Lottie or short video later.
