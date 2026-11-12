# test-app
Testing app connection to claude

A tiny static app for testing building, previewing, and deploying with GitHub.

## Run locally

    npx serve .        # or: python3 -m http.server 8080

## Stages

Each stage is a branch and gets its own URL on GitHub Pages:

| Branch    | URL                                             | Purpose                            |
|-----------|-------------------------------------------------|------------------------------------|
| `dev`     | https://thedodgykiwi.github.io/test-app/dev/     | Day-to-day work, may be broken     |
| `alpha`   | https://thedodgykiwi.github.io/test-app/alpha/   | Early preview for testers          |
| `staging` | https://thedodgykiwi.github.io/test-app/staging/ | Release candidate, final check     |
| `main`    | https://thedodgykiwi.github.io/test-app/         | Production                         |

Changes are promoted one stage at a time: `dev` → `alpha` → `staging` → `main`,
either with a pull request on GitHub or by asking Claude to run the `promote` skill
(`.claude/skills/promote/`), e.g. "promote to alpha" or "what's waiting to be promoted?".
Non-production stages show a coloured banner so they can't be mistaken for production.

## Deploy

Pushing to any stage branch runs `.github/workflows/deploy.yml`, which rebuilds the
site from the latest commit of every stage branch and publishes it to GitHub Pages.

One-time setup:
- **Settings → Pages → Source:** GitHub Actions
- **Settings → Environments → github-pages → Deployment branches:** allow `main`, `staging`, `dev`, `alpha`
