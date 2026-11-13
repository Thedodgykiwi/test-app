# test-app

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
**"Log it" means record only:** create the issue, don't change code. Fix
later on `dev` with `Issue #<n>` (not "Fixes": the default branch is `dev`,
so GitHub would close it on Dev) in the commit message; the Production
release closes the issue automatically. This repo is public, so its issues are
public: no client names, emails or private details.

## Concept first (for bigger ideas)

Before building a **new feature or a noticeable change to how the app looks
or works**, ask the user once whether they'd like a concept mock-up first.
Offer it when there's more than one reasonable design, or the request is
vague. Don't offer it for small tweaks ("make the button blue"), bug fixes or
behind-the-scenes changes; just do those on `dev`.

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

## Quality checklist (before pushing)

- The app loads with no errors in the browser console.
- Existing features still work: adding/toggling to-dos (and that
  they persist after a reload), the "What's new" panel.
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
- Code: `sync.js` (ES module: sign-in, account menu, live sync, copying a
  device's to-dos into the account on first sign-in). `app.js` exposes
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
  Tests: `tests/firestore.rules.test.mjs`; run `npm install` once, then
  `npm run test:rules` (uses a throwaway emulator, needs Java). When the data
  model changes, update the tests with the rules. After changing them, re-run
  the rules tests and deploy with
  `npx -y firebase-tools@latest deploy --only firestore:rules`.
- Local testing without touching the real project: start the emulators with
  `npx -y firebase-tools@latest emulators:start --only auth,firestore --project demo-test-app`
  and open `http://localhost:8080/?emulators`.
- Sign-in is shared by all stages (one web address), but each stage keeps its
  own to-do list. Never delete users' cloud or device data without asking.

## Notes

- `stage.js` is overwritten per stage at deploy time; locally it says `local`.
- Icons: **Phosphor Icons, duotone style only**, stored in `icons.js` (no CDN).
  Use `icon('name')` in JS or `<span data-icon="name"></span>` in HTML. To add
  one, copy the inside of its `<svg>` from `@phosphor-icons/core`
  (`assets/duotone/<name>-duotone.svg`) into `ICON_PATHS`. Don't mix in emoji or
  other icon sets for UI controls. Licence: `LICENSES/phosphor-icons.txt`.
- Home-screen (PWA) icons live in `icons/app/<stage>/`, one colour per stage,
  generated by `tools/make-app-icons.js` (Phosphor "check-circle"). Files in
  the repo point at `icons/app/local/` and say "Test App Local"; the deploy
  swaps in each stage's icons, name and theme colour. Don't hand-edit them.
- **iOS 27 quirk:** Add to Home Screen ignores linked icon files and manifest
  icons and shows a letter tile instead. The deploy therefore embeds each
  stage's `apple-touch-icon.png` into `index.html` as a `data:` URI (tested on
  a real iPhone). Keep that step unless Apple fixes it; after any icon change,
  delete and re-add the home-screen shortcut to see it.
- Browser storage is kept separate per stage (`todos-<stage>` keys).
- Release notes: written once when promoting to Alpha, reused for later
  stages, and shown in the app's "📋 What's new" panel.
