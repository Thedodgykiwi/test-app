# test-app

A small static web app (plain HTML/CSS/JS, no build step) used to test
building, previewing and releasing through stages on GitHub Pages.

## Stages and branches

| Branch    | Stage      | URL                                              |
|-----------|------------|--------------------------------------------------|
| `dev`     | Dev        | https://thedodgykiwi.github.io/test-app/dev/     |
| `alpha`   | Alpha      | https://thedodgykiwi.github.io/test-app/alpha/   |
| `staging` | Staging    | https://thedodgykiwi.github.io/test-app/staging/ |
| `main`    | Production | https://thedodgykiwi.github.io/test-app/         |

Any push to one of these branches redeploys the site (`.github/workflows/deploy.yml`).

## Rules

- **All new work happens on `dev`.** At the start of a task, make sure you're
  on `dev` and up to date (`git checkout dev && git pull`). If you find
  yourself on another branch, switch to `dev` before changing anything.
- **Never commit or push directly to `alpha`, `staging` or `main`.** Changes
  reach them only through the `promote` skill (`.claude/skills/promote/`),
  one stage at a time: dev → alpha → staging → main.
- **Production (`main`) needs the user's explicit "yes"** for each release.
- Urgent production fixes ("hotfixes") are the only exception, and only when
  the user asks for one: fix on a branch from `main`, release it, then merge
  the fix back into `dev` so it isn't lost.

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
- Existing features still work: counter, adding/toggling to-dos (and that
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
