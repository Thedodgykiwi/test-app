# test-app
Testing app connection to claude

A tiny static app for testing building, previewing, and deploying with GitHub.

## Run locally

    npx serve .        # or: python3 -m http.server 8080

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which publishes the site to GitHub Pages.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
