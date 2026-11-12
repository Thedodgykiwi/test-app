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

## Working on a change

1. Make the change on `dev`.
2. Preview it locally: `python3 -m http.server 8080` from the repo root,
   then check it in a browser (stage banner shows "LOCAL").
3. Commit with a clear message and push to `dev`; confirm the deploy succeeds.
4. Ask the user to try it on the Dev URL. Promote only when they're happy.

## Notes

- `stage.js` is overwritten per stage at deploy time; locally it says `local`.
- Browser storage is kept separate per stage (`todos-<stage>` keys).
- Release notes: written once when promoting to Alpha, reused for later
  stages, and shown in the app's "📋 What's new" panel.
