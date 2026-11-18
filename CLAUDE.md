# test-app ("The Shortlist")

A small static web app (plain HTML/CSS/JS, no build step) used to test
building, previewing and releasing through stages on GitHub Pages.

## Playbook

General processes, design patterns and gotchas live in
https://github.com/Thedodgykiwi/app-playbook. Before setting up anything it
covers (new app, stages, deploys, Firebase, icons, design), attach that repo
to the session and read its README and the relevant guide.

**Keep the playbook growing.** Whenever work on this app teaches something
that would help *any* app (a gotcha, a missing or wrong step, a setup
process, a design or wording pattern that worked), update the right guide
in the playbook in the same session, commit it to the playbook's `main`, and
tell the user what was added. App-specific facts stay in this file instead.

## Stages and branches

| Branch    | Stage      | URL                                              |
|-----------|------------|--------------------------------------------------|
| `dev`     | Dev        | https://thedodgykiwi.github.io/test-app/dev/     |
| `alpha`   | Alpha      | https://thedodgykiwi.github.io/test-app/alpha/   |
| `staging` | Staging    | https://thedodgykiwi.github.io/test-app/staging/ |
| `main`    | Production | https://thedodgykiwi.github.io/test-app/         |

Any push to one of these branches redeploys the site. `.github/workflows/deploy.yml`
is a small file that calls the **shared** deploy in the app-playbook repo
(`.github/workflows/deploy-stages.yml`); change the deploy steps there, not here.

## Rules

- **All new work happens on `dev`.** At the start of a task, make sure you're
  on `dev` and up to date (`git checkout dev && git pull`). If you find
  yourself on another branch, switch to `dev` before changing anything.
- **Never commit or push directly to `alpha`, `staging` or `main`.** Changes
  reach them only through the `promote` skill (shared, in the app-playbook repo:
  attach the playbook to use it; there's no copy in this repo),
  one stage at a time: dev → alpha → staging → main.
- **Production (`main`) needs the user's explicit "yes"** for each release.
- Urgent production fixes ("hotfixes") are the only exception, and only when
  the user asks for one: fix on a branch from `main`, release it, then merge
  the fix back into `dev` so it isn't lost.
- **Rollbacks** (undo the last Production release) use the promote skill's
  `rollback` command only, with the user's "yes" and their reason (playbook
  `stages-and-releases.md`).

## Issues (bugs, requests, tweaks)

The repo's GitHub Issues are the to-do list (playbook `issues.md`; labels
`bug`, `feature`, `tweak`, `performance`, `priority: high/low`).
**Every request starts with a choice card** (playbook `issues.md`): for any
feature, fix, tweak or idea, show the AskUserQuestion card with "Log it,
build later" / "Log it + mock-up first" / "Build it now", recommended first,
before doing anything (unless the user already said which).
**Every issue uses the playbook's layout** (`issues.md`, "Writing a good issue":
What's happening / wanted, Where, Expected, Reported by, Notes).
**Every bug the user reports or change they ask for gets an issue,
automatically** (they don't need to say "log it"): create it with the right
label before starting work, and put `Issue #<n>` in the commit. Small
follow-ups to the same piece of work go on that issue, not a new one.
**"Log it" means record only:** create the issue, don't change code. Fix
later on `dev` with `Issue #<n>` (not "Fixes": the default branch is `dev`,
so GitHub would close it on Dev) in the commit message; the Production
release closes the issue automatically. This repo is public, so its issues are
public: no client names, emails or private details.

## Concept first (for bigger ideas)

Offered through the choice card: "Log it + mock-up first" is the recommended
option for a **new feature or a noticeable change** with more than one
reasonable design, or a vague request; "Build it now" for small tweaks ("make
the button blue"), bug fixes or behind-the-scenes changes.

If they say yes:
- Build a clickable mock-up as a Claude artifact, **not** in the repo. Show
  2–3 options side by side when there are real choices, with sample data and
  a short "Good / Watch out" note for each. Match the app's existing look.
- Keep iterating on the same artifact until the user picks a direction.
- Then build the chosen version properly on `dev` and follow the normal flow.
- If artifacts aren't available in the session, use a standalone HTML file in
  the scratchpad and show screenshots instead. Never put concept code in the repo.

## Working on a change

1. Make the change on `dev`.
2. Preview it locally: `python3 -m http.server 8080` from the repo root,
   then check it in a browser (stage banner shows "LOCAL").
3. Commit with a clear message and push to `dev`; confirm the deploy succeeds.
4. Ask the user to try it on the Dev URL. Promote only when they're happy.

## Working with the user

- Explain in plain English and briefly define technical terms; don't
  assume development experience.
- For visual changes, show a screenshot of the result before pushing.
- When something is ambiguous, make a sensible choice and say what you
  chose, rather than asking lots of questions. Ask first for anything
  hard to undo.
- Report honestly: say what was tested, what wasn't, and anything that
  failed.
- End each piece of work with its status: what changed, whether it's
  committed and pushed, and where to see it.
- **Every deploy ends with a link:** the full, clickable address of each stage
  that changed (pushed to Dev or promoted), plus one line on what to look at.

## Quality checklist (before pushing)

- The app loads with no errors in the browser console.
- Existing features still work: adding/toggling/editing to-dos (and that
  they persist after a reload, signed out and signed in), Done and its date
  ranges, the "New:" bar and What's new (menu → version), theme, accent
  colour, offline.
- Layout works on a phone-sized screen (about 375px wide) as well as desktop.
- Basic accessibility: buttons and inputs have clear labels, text has good
  contrast, everything works with the keyboard.
- Keep changes small and focused; one feature or fix per commit, with a
  clear message saying what and why.

## Guardrails

- **No secrets in the repo.** It's public: never commit passwords, API keys
  or personal data.
- **Ask before adding** external libraries, third-party services, tracking or
  analytics, or anything that costs money or needs an account.
- **Don't delete or reset user data** (e.g. saved to-dos in browser storage)
  without asking; if stored data needs a new format, migrate it.
- Keep it plain HTML/CSS/JS with no build step unless the user agrees to change that.
  (`package.json` is for dev-only tests; the app must never import from `node_modules`.)
- Never edit `stage.js` by hand for deploys; the workflow sets it per stage.

## Known gotchas

- GitHub Pages caches pages for up to 10 minutes. CSS/JS are cache-busted
  per deploy, but `index.html` may briefly be stale; a hard refresh
  (Ctrl/Cmd+Shift+R) fixes it.
- All stages share one web address, so anything stored in the browser must
  be keyed per stage (see `storageKey` in `app.js`).
- Stage branches show as "behind" `main` on GitHub because of promotion
  merge commits. That's expected; file contents match.
- Verify UI changes from a screenshot, not just by reading element state:
  CSS `display` rules can override the `hidden` attribute (a global
  `[hidden] { display: none !important; }` rule in `style.css` now guards this).
- When promoting by pull request on GitHub, the default target is `dev`;
  change the base branch, or use `compare/<destination>...<source>` links.

## Firebase (sign-in and cloud to-dos)

- Project: `test-app-52149`. Google sign-in (Firebase Authentication) plus
  Cloud Firestore. Signed out, to-dos stay on the device exactly as before;
  signed in, they're saved to `users/{uid}/stages/{stage}/todos/{id}`
  (separate list per stage, same as browser storage).
- Code: `app/store.js` (to-dos and saving; `window.TodoApp` hooks), `app/main.js`
  (the to-do screen as Preact components), `sync.js` (ES module: sign-in, account menu, live sync, copying a
  device's to-dos into the account on first sign-in). `app/store.js` exposes
  `window.TodoApp` hooks for it. The SDK loads from gstatic, pinned in `sync.js`.
- `firebase-config.js` holds the web app settings (not secret). While it's
  `null`, sign-in is hidden and nothing talks to Firebase.
- Set up: web app "Test App (web)" (`1:245899552801:web:698ea4d0a5a8c9d852db60`);
  Firestore `(default)` database in `eur3` (Europe; can't be moved), Standard
  edition, free tier, delete protection on; Google sign-in on, with
  `thedodgykiwi.github.io` and `localhost` as authorised domains.
- Keep Auth provider settings (they include a support email) out of
  `firebase.json`: the repo is public.
- Use the official Firebase agent skills (github.com/firebase/agent-skills)
  and the Firebase plugin/MCP server for Firebase work; run the CLI as
  `npx -y firebase-tools@latest`.
- Security rules: `firestore.rules` (owner-only, every field validated).
  Tests: `tests/firestore.rules.test.mjs` (to-dos and issue reports); run `npm install` once, then
  `npm run test:rules` (uses a throwaway emulator, needs Java). When the data
  model changes, update the tests with the rules. After changing them, re-run
  the rules tests and deploy with
  `npx -y firebase-tools@latest deploy --only firestore:rules`.
- Local testing without touching the real project: start the emulators with
  `npx -y firebase-tools@latest emulators:start --only auth,firestore --project demo-test-app`
  and open `http://localhost:8080/?emulators`.
- **Fast first load (Issue #36):** while signed in, the last list shown is kept
  in browser storage (`cloud-copy-<stage>`, removed on sign-out) and shown at
  once on the next open, with "Updating…" in the summary, a blue dot and
  edits paused ("One moment, connecting…") until Firebase is ready; to-dos
  that changed meanwhile flash briefly when the live list arrives.
- Sign-in is shared by all stages (one web address), but each stage keeps its
  own to-do list. Never delete users' cloud or device data without asking.

## Report issue (stage banner, Issue #28)

- Dev, Alpha, Staging (and local) show **Report issue** at the banner's left
  end (`report.js`): a drop-down with Title + Description (required) and an
  optional type, plus an optional screenshot (Issue #35; shrunk on the device,
  shown in the issue from the `issue-images` branch). It saves to Firestore `issueReports/{id}` via
  `window.AppCloud` (set up in `sync.js`).
- Only signed-in people whose email is in **`access/testers`** (field
  `emails`, lower-case) can submit (`firestore.rules`). Edit that list in the
  Firebase console; never put the addresses in the repo.
- `.github/workflows/issue-reports.yml` calls the playbook's **shared** job
  (`report-issue.md`; change it there, not here) every 5 minutes from `dev` (GitHub often runs it late: expect 5–15 min; "Run
  workflow" collects now). It creates the issue (layout from the playbook,
  "Reported by: tester"), marks the report `logged` and emails the reporter a
  receipt from Gmail (no GitHub links).
- **"It's fixed" email (Issue #34):** the same job checks `logged` reports'
  issues. Closed *and* in Production's release notes (the bullet ending
  "(#n)" in `<APP_URL>/releases.json`) → emails that line as "What changed",
  marks the report `fixed`. Closed without a release (or "not planned") →
  `closed`, no email. Either way the reporter's address is deleted then; it
  is kept until then (Firestore only, unreadable from the app). Closing a
  test issue by hand never emails anyone.
- Secrets (repo Settings → Secrets → Actions): `FIREBASE_SERVICE_ACCOUNT`
  (service account key JSON), `GMAIL_USER`, `GMAIL_APP_PASSWORD`. Without the
  first, the job does nothing; without the Gmail ones, it skips emails.
- Local test of the job: playbook `report-issue.md`, "Testing the job locally".

## Notes

- `stage.js` is overwritten per stage at deploy time; locally it says `local`.
- **Look and layout (Nov 2026, from the playbook starter):** the starter's style
  kit in `style.css` (top part; test-app's own rules are in the section at the
  end), `menu.js` (menu: photo, theme, Settings with accent colour and text
  size, version → What's new), `pwa.js` + `sw.js` (offline, install, "new
  version" bar), `styleguide.html`; the to-do screen is Preact components (`app/`, libraries in `vendor/`).
  Layout: a soft panel per priority (option D, Issue #19) with roomy rows, Done
  at the end, add bar in a panel at the bottom (clear of the home bar). `whats-new.js` is only the "New:"
  bar now; the panel is menu.js's. `sync.js` fills in the menu's account part.
  When the starter's shared pieces improve, copy them over (they're app-owned copies).
- **Due-date quick menu (Issue #38):** a row's due label ("Due today",
  "Overdue…") is its own button; tapping it opens `DueMenu` in `app/main.js`
  (Today / Tomorrow / Next week = the coming Monday, Pick a date…, No date) with an Undo note. Swipe left on a row
  also sends it to tomorrow, or brings a due-tomorrow one forward to today; a to-do with no date shows "When?" and opens the same menu (Issue #39, `useSwipe`; same code as swipe right
  to star). Choosing each swipe's action in Settings is the rest of #39 (not built).
- **Delete (Issue #40):** red Delete on the left of Cancel / Save in the edit
  sheet; first tap arms it ("Tap again"), disarms after 3 s. `remove()` in
  `app/store.js`; `firestore.rules` allows owner-only deletes.
- **Quick add (Issue #41):** press N on a keyboard (not while typing, not
  with a sheet open) for a centred pop-up (`QuickAdd` in `app/main.js`); Enter
  adds and clears so several can be added in a row, Esc or empty Enter closes.
- **Words understood (Issue #42):** `parseEntry()` in `app/main.js`: a date
  word (today/tod/tonight/ton, tomorrow/tom/tmrw, next week/nw) and/or a
  priority letter L/M/H at the **start or end** of the text (never the
  middle) set due/priority and leave the title; live chips (`Understood`)
  under the add box and quick add show what was understood. Keyword-only text
  stays a plain title. `add(text, p, due, evening, time, starred)`. A single **S**
  at the start or end stars it (Issue #53; "Starred" chip).
- **Tonight (Issue #43):** an `evening: true` flag on a to-do due today. It
  sorts after the day's others under a "Tonight" divider inside the Due
  today panel, with a moon "Tonight" label. Set by typing "tonight"/"ton"
  (#42 parser) or the due menu's Tonight; Today / any other date clears it
  (`setDue`, edit sheet). `firestore.rules` allows the optional bool. The
  divider ("Tonight · 2") folds those rows away (Issue #52; `collapsed` key `tonight`);
  ticking off the last daytime Due today to-do unfolds it again (`markDone`, Issue #56).
- **Checklist (Issue #44):** optional `items: [{ text, done }]` (≤50, text
  ≤200; `cleanItems` in `sync.js` tidies before saving, since rules can't
  look inside a list). `Checklist` in `app/main.js`: tick, rename in place
  (empty = delete), drag the handle or Alt+arrows to reorder, "Add item…".
  Rows with items show a "2/4" pill that unfolds the list under the row
  (`expanded` signal); the edit sheet has "Add a checklist" / the same list.
  Cards use `overflow: clip` (not hidden) so a focused input can't scroll
  them sideways.
- **Note (Issue #57, option A):** optional `note` (plain text, ≤2000 chars,
  null clears it; `firestore.rules` checks it). Edit sheet: "Add a note" beside
  "Add a checklist" (`.sheet-adds`, stacks on very small phones) opens a
  textarea saved with Save. Rows with a note show a "Note" pill
  (`noteOpen` signal; outlined, not filled, so it differs from the checklist pill
  without drawing too much attention: a dark filled pill was tried and rejected) that unfolds `NoteText` under the row; http(s) and www. links are tappable.
  Tapping the open note's text edits it in place (saves on leaving the box,
  Esc cancels, emptied = note removed), like the checklist.
- **Edit panel (Issue #60, option A, replaces Cancel / Save):** `EditSheet`
  in `app/main.js`, class `sheet compact`. Title (one line, grows) with the star
  beside it, small "Priority" and "When" labels over the chips, "At" time row,
  dashed add-chips (Time / Checklist / Note), quiet Delete (tap twice) and
  **Done** (Enter in the title also closes). Every change applies at once via
  `apply()` with an Undo note **inside the panel** (the page toast sits behind
  an open dialog); title and note save when you leave the box.
- **Edit sheet layout (Issues #46, #47):** star is a round toggle in the header
  (`#edit-star`, gold when on); "Add a checklist" sits right under the text box.
  Starred panel sorts by due state, then High/Medium/Low/none (Issue #48), and
  has a thin gold edge (other panels don't; Issue #68).
- **Scheduled time (Issue #50, option B):** optional `time: 'HH:MM'` (24-hour)
  on a to-do with a date. Edit sheet: "Add a time" under Due, then a time
  box + "Remove time"; clearing the date clears it. Typed: 4pm, 4:30pm, 13:00
  or 1300 at the start/end (`TIME_RE`/`toTime` in `parseEntry`); a time with
  no date word means today; a bare number stays in the
  title. Row label adds " · 4pm"; Due today/tomorrow sort timed ones first,
  earliest first. **Tonight = 5pm on** (`EVENING`): today + a time from 5pm is
  a Tonight to-do ("tod 6pm" too); "ton 9am" drops the time. Edit sheet time is
  a 15-minute list; for Tonight, times before 5pm are greyed out; tapping Today
  leaves Tonight (and clears an evening time). `setDue` drops times that no
  longer fit. **No past times today:** passed times are greyed out in the
  sheet ("Add a time" starts at the next free quarter-hour); typed "tod 6am"
  after 6am keeps Today, drops the time and shows a "6am has passed" chip; a
  time alone that has passed ("6am") means tomorrow. Reminders: not built (Issue #51).
- **Archive done to-dos (Issue #49, option B):** "Tidy up" on the Done heading
  (only while Done is open and there are done to-dos older than today; small and quiet, Issue #59) opens `TidyMenu`: Older
  than 30 days / Older than 7 days / Everything except today, each with a
  count. Sets `archived: true` (kept, hidden everywhere, not counted); Undo in
  the note sets it back. `firestore.rules` allows the optional bool. A way to
  see archived ones again isn't built yet.
- **Edit sheet calendar (Issue #45):** hidden behind a "Pick" chip; shows on
  its own when the date isn't today / tomorrow.
- **Add bar (Issue #66, option 1 + 2):** a floating pill (12px from the edges
  plus the home-bar space, `viewport-fit=cover`, Issue #65; capped to the
  list's width on desktop) holding a 53px rounded box with the priority button
  and a round **+** (the Add button, text hidden but read out) inside its right
  end. The typing chips sit under the box, lined up with its text. Rules are
  at the end of `style.css`.
- **Compare stages (Issue #69):** shared, from the playbook's deploy
  (`compare-stages.md`): Pipeline page → Compare tab, `?compare` mode (all
  stages share one sample list in the browser; no sync) and the banner's stage
  menu. This app's part: `compare-sample.json` (keep one of each feature in it
  when adding features) and `window.COMPARE` skips the swipe tip.
- **Lists panel and views (Issue #71, option A + tappable title from C):** "‹ Lists"
  above the title, or tapping the title ("The Shortlist ▾" / "My Day ▾"), opens a side
  panel (`ListsPanel`, `ViewHead` in `app/main.js`; the page's static `<h1>` is replaced):
  All to-dos, My Day, Important (starred), Planned (has a date; one group per day) and
  Completed (Done, always open), each with a count. From 1100px wide it stays open as a
  sidebar. The chosen view is remembered per stage (`view-<stage>`). Adding while a view
  is open puts the to-do in it (My Day / starred / due today). **My Day** = optional
  `myDay: 'YYYY-MM-DD'` (`firestore.rules` checks the format; counts only on that day, so
  it empties each morning); toggled by the edit panel's "My Day" chip; rows elsewhere
  show a small sun "My Day" tag. Custom lists (Home, Work…) are Issue #72, not built.
  **Settings → List style** (`listStyle` pref in `menu.js`, `data-list-style` on `<html>`;
  Pills default / Lines / Boxes) sets how My Day, Important and Planned group to-dos:
  Pills = small rounded headings over plain cards (`.vg-*`), Lines = Done-style
  dividers, Boxes = the main view's coloured panels. Planned groups by day; My Day by
  Overdue / Today / Tonight / Later / Any time; Important adds Tomorrow and No date. With
  only one group (not Planned), no heading. Folded groups are remembered (`vg-…` keys).
  Starred to-dos show a small gold ★ beside the priority bars where no Starred panel says
  it (not on All to-dos or Important). All to-dos always keeps its panels.
  Settings order: List style, Accent colour, Text size.
- **Done today (Issue #74):** under All to-dos, My Day and Important, `DoneSection`
  shows only to-dos ticked off today ("Done today · n", folded with the same
  `done-open` key) and a "See all completed (n) →" link to the Completed view. The
  full history, its date groups and Tidy up are only in Completed.
- **Text size (Issue #73):** Small (93.75%) / Regular (value `standard`, 100%) /
  Large (112.5%) on `:root`. With Small, typing boxes stay at 16px (iPhone Safari
  zooms the page into any box under 16px).
- **Add-box hint lines (Issue #37):** `HINTS` in `app/main.js`, a random
  award-night line per open and after each add (never the same twice running).
  Keep each to about 22 characters so it fits a phone; the box only reserves
  room for the priority word once a priority is picked.
- Icons: **Phosphor Icons, Regular style only** (since the new look; home-screen
  icons stay duotone), stored in `icons.js` (no CDN). Use `icon('name')` in JS or
  `<span data-icon="name"></span>` in HTML. To add one, copy the inside of its
  `<svg>` from `@phosphor-icons/core` (`assets/regular/<name>.svg`) into
  `ICON_PATHS`. Don't mix in emoji or other icon sets for UI controls. Licence:
  `LICENSES/phosphor-icons.txt`.
- Home-screen (PWA) icons live in `icons/app/<stage>/`, one colour per stage,
  generated by the playbook's **shared** `tools/make-app-icons.js` (Phosphor
  "list-checks", bold): `node <playbook>/tools/make-app-icons.js --phosphor
  <@phosphor-icons/core package> --glyph list-checks --weight bold --out
  icons/app` (playbook `pwa-icons.md`). Files in
  the repo point at `icons/app/local/` and say "The Shortlist Local"; the deploy
  swaps in each stage's icons, name and theme colour. Don't hand-edit them.
- **iOS 27 quirk:** Add to Home Screen ignores linked icon files and manifest
  icons and shows a letter tile instead. The deploy therefore embeds each
  stage's `apple-touch-icon.png` into `index.html` as a `data:` URI (tested on
  a real iPhone). Keep that step unless Apple fixes it; after any icon change,
  delete and re-add the home-screen shortcut to see it.
- Browser storage is kept separate per stage (`todos-<stage>` keys).
- Release notes: written once when promoting to Alpha, reused for later
  stages, and shown in What's new (menu → version). Dev shows its changes by
  day instead (up to 200, built by the playbook's shared release-notes script).
