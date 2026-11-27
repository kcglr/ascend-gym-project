# Ascend: Daily Quest

A gamified daily workout tracker. The quest is push-ups, sit-ups, squats and a run, placed by a
fitness test and ramping toward 100 / 100 / 100 / 5 km. Clearing it earns XP, levels, ranks from E
to S, titles, skills and loot. The rules follow the design doc "Daily Quest: Leveling & Rewards
Design" (26 Nov 2026) and the look is the "Abyss System" style: dark neon system windows, steel
filigree, cyan and violet glow, with painted art made for this app.

**Play it: https://kcglr.github.io/ascend-gym-project/**

It is an installable web app. It opens full screen from the home screen, works without a
connection, and updates itself when a new version is deployed.

## Putting it on a device

| Device | How |
| --- | --- |
| iPhone or iPad | Open the link in **Safari**, tap **Share**, then **Add to Home Screen**. Open Ascend from its icon and start there: the app on the Home Screen keeps its own progress, separate from Safari. |
| Android | Open the link in Chrome and tap **Install** on the first screen, or use the browser menu, **Add to Home screen**. |
| PC or Mac | Open the link. Chrome and Edge show an install icon in the address bar and an **Install** button on the first screen. Safari on a Mac has **File, Add to Dock**. A plain browser tab works too. |

Progress is stored on the device, in the app. There are no accounts and no server. To keep a copy
or to move progress between a phone and a PC, use **System, Backup** (see [Backup](#backup)).

## Files

| File | What it is |
| --- | --- |
| `engine.js` | Every game rule. Pure logic: no DOM, no storage, no clock. Takes the player state (plain JSON) and returns events. Meant to move into the iOS app as it is. |
| `ui.css` | The whole look: colour tokens, skins, frames, bars, buttons, every screen and every animation. |
| `ui.js` | Storage, cloud save, backup, screens, windows and actions. It talks to the app shell through `window.AppShell` and works without one. |
| `app.src.html` | The page as a Claude Artifact takes it: the fixed layers (backdrop, the frame `#view` the page scrolls in, the small header, tab bar, the layer windows fade out on, window layer, toasts, spark canvas) between `<!--BODY-->` marks, and the placeholders `/*CSS*/`, `/*ENGINE*/` and `/*UI*/`. |
| `pwa/` | What turns the page into an installable web app. `shell.html` is the full document with the iPhone and Android tags, `pwa.css` the styles a standalone app needs (notch, home bar, no text selection), `pwa.js` the shell (`window.AppShell`: versions, updates, installing), `sw.js` the service worker, `manifest.webmanifest` the web app manifest, `fonts/` the three typefaces (SIL Open Font License), `icons/` and `splash/` the home-screen icons and the iPhone launch pictures. |
| `assets/` | 17 WebP pictures (about 900 KB) and `manifest.json`, which names them and gives the icon sheet's layout. |
| `art/` | `src/` holds the masters as they came from the image model, `samples/` the three style samples. `process.py` cuts the masters into `assets/`. `app_icons.py` composes the icons and launch pictures in `pwa/` from the same art. |
| `build.js` | `node build.js` builds both forms of the page into `dist/` and stops if a picture, an icon or a file is missing. |
| `tests/engine.test.js` | 74 rule tests. `node tests/engine.test.js` |
| `tests/sim.js` | Plays up to 800 days for several player types and prints the pace. `node tests/sim.js` |
| `tests/ui.test.js` | 28 checks that drive the Claude Artifact form in a phone-sized headless browser, including two devices sharing a stand-in cloud, reduced motion, and every picture loading. |
| `tests/pwa.test.js` | 23 checks that drive the installable web app the way a phone does: install tags and manifest, offline play, new versions (in use, while opening, half deployed, second window), backup and restore, the notch, the tab bar while scrolling and typing, and three screen sizes. |
| `tests/gallery.js` | Takes pictures of every screen and reward moment for looking at the design. `node tests/gallery.js [scene ...] [--out dir] [--scale 2] [--width 400]` |
| `tests/serve.js` | The small server the browser tests use. It serves either form, and can swap the site for a "new deploy" or go offline. |
| `.github/workflows/deploy.yml` | Runs the rule tests and the build, then publishes `dist/site` on GitHub Pages. |
| `v1/` | The first prototype, kept for the tests that carry an old save over. |

## Build, test, deploy

```
node build.js                 # dist/site (the web app) and dist/artifact (the Claude Artifact)
node tests/engine.test.js     # the rules
node tests/ui.test.js         # the Artifact form in a browser
node tests/pwa.test.js        # the web app in a browser
```

The build needs only Node. The two browser test files need Playwright with Chromium
(`npm i -D playwright && npx playwright install chromium` on a machine that does not have it).
`python3 art/app_icons.py` (Pillow, numpy, fonttools) is only needed to redraw the icons or the
launch pictures.

**Deploying.** Every push to `main` runs `.github/workflows/deploy.yml`, which publishes
`dist/site` at https://kcglr.github.io/ascend-gym-project/. Installed copies pick the new version
up by themselves. The repository setting **Pages, Source** has to be **GitHub Actions**. A pull
request runs the rule tests and the build without deploying.

**The Claude Artifact form.** `dist/artifact/index.html` is the same page as a body fragment for a
Claude Artifact, published with every `assets/*.webp` at `assets/<name>.webp` and the capabilities
`{ db: {}, user: {} }`. Inside Claude the page has a private cloud save and no app shell.

## The installable web app

- **One page.** `build.js` inlines the styles, the engine, the shell and the UI into
  `dist/site/index.html`, so the first paint needs one request. Pictures, fonts and icons sit
  beside it. Nothing is loaded from another site.
- **Versions.** The version is a fingerprint of everything the site serves (the first ten digits
  of a SHA-256), so the same sources always give the same version and any change gives a new one.
  The System screen shows it with the date of the last change to the app.
- **Offline.** `sw.js` keeps one complete copy of the app (the page, the pictures, the fonts,
  about 1.5 MB) in a cache named after the version, and answers every request in the app's folder
  from it. It fetches past the browser's own cache, refuses to store a page from another version,
  and puts a file back if the device dropped it.
- **Updates.** A new deploy changes `sw.js`, the browser installs the new copy beside the old one,
  and the shell decides when to switch. While the app is still opening and nothing was tapped, it
  switches at once. Otherwise a bar says a new version is ready and one tap reloads into it. A
  half finished deploy (new worker, old page) fails to install and is tried again later. The
  check runs when the app opens, when it comes back to the front after half an hour, and from
  **System, App, Check for updates**.
- **Installing.** Chrome's install offer becomes an Install button. An iPhone gets the Share, Add
  to Home Screen steps, on the first screen and under System. Once installed, neither shows.
- **iPhone details.** `viewport-fit=cover` with a translucent status bar, a blurred strip under
  the clock, room for the home bar under the tab bar, a 180 px touch icon, and one launch picture
  for each of 13 iPhone screen sizes (an iPhone only shows one that matches its screen exactly).
- **Storage.** The shell asks the browser to keep the storage (`navigator.storage.persist`). A
  home-screen app on an iPhone is not subject to Safari's seven-day clean-up of unused sites, a
  Safari tab is. That is one more reason to install it and to keep a backup.

It was tested in Chromium at phone and desktop sizes, with an iPhone's browser name and screen
insets. It has not been run on a real iPhone or in Safari.

## The look

The theme is the "Abyss System": dark neon system windows, cyan and violet glow, and painted art
made for this app. The layout follows well-established fitness apps: calm screens, one clear thing
to look at, and the details a tap away.

**Layout rules**

- **A title, one hero, then sections.** Each screen opens with its title (the only italic capital
  heading on it) over a small caption line. At most one lit, framed panel follows: the day ring on
  Quest, the licence on Hunter, the gate on Hunter Hall. Everything else is a titled section that
  holds a calm card or a grouped list of rows split by hairlines, the way a settings app does it.
- **Progress is a ring.** The day's quest is one ring with marks at 25% (no penalty), 75% (the
  streak grows) and the chest at 100%. Each task has a small ring around its icon that closes as
  reps come in and turns green with a check when the task is done. Each day in the Log calendar is
  a ring that closes as far as that day got.
- **One loud thing per screen.** Glow, italic display type and the glossy button are kept for the
  hero, the one primary action and the reward windows. Lists, rows and settings are plain
  sentence-case text.
- **Details on request.** Only the open task shows its buttons. The XP breakdown folds away under
  "Earned today". "How did it feel?" shows until it is answered. "Also today" lists only what can
  be done today: a Rank Trial, a rest token, Overdrive, a re-test.
- **Room.** A 20 px gutter (`--gut`), 26 px between sections (`--gap-sec`) and 10 px inside them
  (`--gap-in`). The screens are checked from a 320 px phone to a PC, where the app keeps a
  phone-width column.
- **Bars like a phone's own.** The tab bar and the small header that follows the page down are
  flat, blurred strips. The small header shows level, XP and streak on Quest and the screen's name
  everywhere else.
- **One message at a time.** Small messages ("Strength +1", a new title) wait while a reward window
  is up and come in after it closes.

**Kept from the game look**

- Depth in layers: a painted backdrop, slow drifting motes, the hero panel with the hunter breaking
  out of it, and a spark layer on top.
- Rank crests that grow with the tier: E is a bare shield, C grows wings, S has a crown and halo.
- Reward moments with a reveal: the chest is tapped open and the loot counts up, a level-up bursts,
  a rank-up cracks the old crest and slams the new one in.
- Red dots on tabs that have something to do, and the Essence pill on Hunter.

**How it is built**

- Colours are tokens on `:root` as bare RGB triples (`--g` glow, `--v` violet, `--ln` line, `--p1`
  and `--p2` panel, `--ink`), so `rgb(var(--g) / .4)` works anywhere. The four shop themes re-set
  the tokens under `:root[data-skin]` and turn the painted scenes with `--hue`.
- A mood class re-colours a whole subtree: `.gold`, `.warn`, `.ok`. Aura classes `.aura-0` to
  `.aura-5` set `--a` and `--a2` for crest glow, hero aura and the licence card.
- Every framed thing shares one recipe at the top of `ui.css`: `::before` is the edge, `::after`
  the surface, both cut by one chamfer polygon from `--c`. It is calm by default (a faint edge and
  a flat fill, for `.card`, `.opts`, `.quests`, buttons) and lit for `.win`, `.hero` and `.pcard`.
  A new framed component only joins that selector list and sets `--c`, `--edge` and `--fill`.
- Screens are put together from a few helpers in `ui.js`: `head()` for the title, `sect()` for a
  titled section, `card()` for a calm card, `group()` and `opt()` for a list of rows, `banner()`
  for a notice that needs a decision.
- Icons are one sprite (`assets/glyphs.webp`, 5 by 4 cells) used as a CSS mask, so they take the
  text colour. `ic('name')` in `ui.js` picks the cell; the names are the `GLYPHS` list, which has
  to match `manifest.json`. Painted objects are plain images through `ob('name')`.
- The screen is described as HTML after every tap and patched in place (`morph()` in `ui.js`), so
  what stays on screen stays the same element. See Motion below.
- Sparks are drawn on one fixed canvas (`burst()`, `burstAt()`), in the colours of the current skin.
- With "reduce motion" switched on, every animation is cut to nothing, numbers do not count up and
  no sparks are drawn. Everything still shows.

**Art.** All of it was generated for this app with the Higgsfield connector (model
`gpt_image_2_6`, the backdrop with `z_image`), about 12.4 credits in total. Prompts describe traits
and never name a game, a show or an artist. Sheets were generated on black and cut out by
`art/process.py`, which also un-multiplies the glow so edges stay clean on any colour. To change
a picture, replace its master in `art/src/`, run `python3 art/process.py`, then `node build.js`.

**How the screens work**

- **Quest:** the day ring, the level strip, then the task list. The list shows the buttons of one
  task at a time. It opens the first unfinished task, and a tap on any row opens that one. A task
  that is finished stays open for a moment, checked, then folds away while the next one opens.
- After a clear the reward waits in a chest: "Open the chest" shows the Essence, the XP and the
  "how did it feel" question.
- **Hunter:** a segmented control (Card, Titles, Skills, Shop). Card shows the licence, the three
  stats and what the next rank asks for.
- **Log:** the last five weeks as rings, with the picked day's four tasks underneath, then the
  streak, the road to the full routine and lifetime totals.
- **System:** grouped settings rows: Hunter, Training, App, Your progress, Testing.
- The tab bar has icons, and a red dot when a Rank Trial can start, a skill slot is free, a
  re-test or a backup is due, or a new version of the app is waiting.

## Motion

A few rules keep every screen moving the same way.

- **One set of curves.** `ui.css` names them (`--ease-out`, `--ease-in`, `--ease-inout`, `--spring`)
  and `ui.js` uses the same ones (`EASE`). Things that arrive slow down into place, things that
  leave speed up and are quicker than arrivals, things that change in place ease in and out. Only
  rewards and presses overshoot.
- **Durations by weight.** A press goes down in 70 ms. Small changes take 140 to 240 ms. A card
  unfolding or the tab light gliding takes about 400 ms, a reward window about half a second. The
  day ring sweeps up when Quest opens and slides to each new value in 0.9 s, the bars in 0.7 s.
- **Presses.** Every button goes down at once and springs back when the finger lifts. On an iPhone
  the page listens for touches so the pressed state shows at all.
- **Nothing is redrawn.** `render()` describes the screen as HTML and `morph()` patches the page,
  matching elements by `data-key` (or id). A bar slides to its new width, a field keeps its text and
  its keyboard, a pressed button springs back instead of being replaced. Effects are asked for in
  the HTML (`data-fx` for bump, stamp, node, lit and enter; `data-roll` for a number that counts to
  its new value) and played once after the patch with the Web Animations API. `changed()` and
  `roll()` remember what each part showed last, so an effect only plays when a value really changed.
- **Feedback where the thumb is.** "+5" rises off the button that was pressed. "+12 XP" appears
  beside the level bar that is in view and adds up over quick taps. A finished task's row flashes
  green and its ring gets a check. On an iPhone with iOS 18 or later, taps and finished tasks give a light haptic tick
  (`haptic()`); Android phones vibrate briefly.
- **One thing after another.** A finished card holds for a beat, then folds while the next one
  unfolds. A window rises and its parts follow 45 ms apart. A window that closes fades out on a
  layer of its own (`#ghost`), so the page or the next window is live at once. Messages that come
  with a reward window wait for it to close (`later` in `ui.js`).
- **Moving between tabs.** Each tab keeps its scroll position. The page slides toward the side of
  the tab that was tapped (View Transitions where the browser has them, a short slide elsewhere)
  while the light behind the tabs glides across. The mark in Hunter's segmented control glides the
  same way. The open tab, or the small header that follows the page down, takes you back to the top.
- **The frame.** The document itself never scrolls. The page scrolls inside `#view`, a fixed frame,
  and the tab bar, the small header and the windows are laid out against it and pinned to what is
  really visible (`--vv-top`, `--vv-gap`). While a field is being typed in on a phone, the tab bar
  and the small header step aside (`.typing`), messages ride just above the keyboard (`--kb`), and
  whatever the keyboard moved is put back when it goes. This is what keeps the tab bar on the
  bottom edge on an iPhone, where it used to stay halfway up the screen after the keyboard closed.
- **Reduced motion.** With "reduce motion" switched on, nothing moves, numbers do not count, no
  sparks are drawn and tabs switch at once. Everything still shows.

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

The page plays from a copy on the device. As a web app that copy is the only one, which is what
the backup is for. Inside Claude the page also mirrors it to a private cloud save, so progress
follows the person to other devices.

**Storage keys** (`localStorage`)

- `dailyquest.v2`: the player state, plus `rev`, `savedAt` and `debugOffset` added by the UI.
- `dailyquest.v2.meta`: `{ device, dead[], backupAt }`. `dead` lists erased players, `backupAt`
  is when the last backup was made.
- `dailyquest.v2.pretest`: the real save, set aside while the test clock runs.
- `dailyquest.v2.stash`: the copy that was replaced last, by a cloud sync or by restoring a
  backup. Kept 30 days and restorable from System, Data.
- `dailyquest.v1`, `dailyquest.v1.done`: a save from the first prototype and its "carried over" mark.

### Backup

**System, Backup, Save a backup** hands over the whole progress as one file,
`ascend-backup-<date>.json`. On an iPhone it goes through the share sheet (Save to Files, AirDrop,
Mail), elsewhere it is a download, and where neither is possible (inside Claude, or an old iPhone)
it is shown as text to copy. **Restore a backup** takes the file or the pasted text, shows whose
progress it is and asks before it replaces anything. The replaced copy goes to the stash. The
first screen has "I have a backup to restore", so a new device does not need the Awakening Test.

```json
{ "app": "ascend-daily-quest", "format": 1, "exportedAt": "2026-11-26T11:04:05.068Z",
  "name": "Kai", "level": 12, "rank": "D", "state": { "v": 2, "sid": "p1a2b3c", "...": "..." } }
```

`state` is the engine's player state as it is, so the iOS app can read the same file. `name`,
`level` and `rank` are only there for a person looking at the file. A restore checks the state the
way a cloud save is checked, plays a copy forward to today to make sure it runs, and scores the
days since it was last played like any other days away. A backup from a newer version of the
rules is refused. The System tab shows a dot when a backup is due: a week after starting, then
every two weeks. Backups are blocked while the test clock runs.

### Cloud save (inside Claude only)

Artifact capabilities `db` and `user`, declared as `{ db: {}, user: {} }` at publish.

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
- Without the capabilities (the web app, a saved file) the page uses device storage only and says
  so on the System screen.

**Test clock.** System has "Skip to tomorrow" for trying penalties and reports. It is a sandbox: the
real save is set aside, nothing is sent to the cloud, and "Back to today" restores it.

## Not in this build

Weekly raid quests, endless mode after S rank, the Hunter's Instinct skill (shown as coming later),
title effects, sounds, sharing the card as an image, other hunters in Hunter Hall, GPS runs,
Apple Health, notifications and camera rep counting. The last four need the native app, and the
Hall needs accounts and a server.

## Path to iOS

`engine.js` has no browser dependencies, so it can run unchanged in React Native (Expo) with the
same JSON state in AsyncStorage or SQLite. A backup file from the web app holds exactly that state,
so progress moves over by importing it. The screens are rebuilt as native components, and the
native app adds what the web cannot do: reminders, HealthKit or GPS for the run, haptics. SwiftUI is
the alternative for an iOS-only app with deep Apple Watch support; the engine is then ported to Swift.

The art moves over as it is: `assets/` is plain WebP with transparency plus `manifest.json`, and
the pictures are large enough for 3x screens at the sizes used here (crests 384 px, hunter 1024 px tall).
The icon sheet is white on transparent, so `tintColor` colours it. The frames are CSS here; in
React Native they become an SVG path or a small 9-slice image per frame, with the same chamfer and
edge colours taken from the tokens at the top of `ui.css`. The reward animations are short enough
to rebuild with Reanimated, or to replace with Lottie or short video later.
