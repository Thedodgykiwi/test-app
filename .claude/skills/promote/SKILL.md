---
name: promote
description: Promote code from one deployment stage to the next (dev → alpha → staging → main/production) and confirm the GitHub Pages deploy succeeded. Use when the user asks to promote, release, push or ship changes to alpha, staging, main or production, or asks what is waiting to be promoted.
---

# Promote between stages

Stages, in order: **dev → alpha → staging → main** (main = Production).
Code only ever moves one step at a time. Never skip a stage and never push
directly to alpha, staging or main except through this skill.

Each stage deploys to GitHub Pages via `.github/workflows/deploy.yml`:
- dev → `/dev/`, alpha → `/alpha/`, staging → `/staging/`, main → `/` (root)

All mechanical work is done by `promote.sh` in this directory. Run it from
the repository root.

## Steps

1. **Show what's pending.** Run:

       .claude/skills/promote/promote.sh status

   Tell the user which commits are waiting at each step, in plain language.

2. **Work out the target.** The user names the target stage ("promote to
   alpha", "push to staging", "release to production"). Map "production" or
   "prod" to `main`. If they say "promote dev", the target is the next stage
   (`alpha`). If the request is unclear, ask.

3. **Preview.** Run:

       .claude/skills/promote/promote.sh <target> --dry-run

   Summarise the commits that will move, then **ask the user to confirm**,
   unless they already clearly asked for this specific promotion in their
   current message. Promotion to `main` (Production) always needs an
   explicit "yes" for that promotion, even if they confirmed earlier ones.

4. **Promote.** Run:

       .claude/skills/promote/promote.sh <target>

   The script merges the previous stage into the target with a merge commit
   ("Promote <source> → <target>"), pushes it, and waits for the deploy
   workflow run for that exact commit. Give it a timeout of at least 6 minutes.

5. **Report.** Tell the user whether the deploy succeeded and give the stage
   URL. Remind them a hard refresh (Ctrl+Shift+R) may be needed for up to
   10 minutes, because GitHub Pages caches pages.

## When things go wrong

- **"Working tree has uncommitted changes"** — don't stash or discard them.
  Tell the user and ask whether to commit them (to dev) first.
- **Merge conflict** — the script aborts the merge and changes nothing.
  Report the conflicting files. A conflict means someone changed the target
  branch directly; fix it on `dev` and promote again, don't edit the target.
- **Deploy failed** — report the run URL the script prints. The code is
  already on the target branch; fix forward on `dev` and promote again.
- **Push rejected** — someone else updated the target. Re-run the script; it
  fetches first.
- **"Nothing to promote"** — the target already has everything from the
  previous stage. Say so; don't create an empty commit.

## Notes

- The script returns you to the branch you started on.
- Prefer a pull request on GitHub if the user wants a review step or
  discussion before promoting. This skill is for direct promotion when the
  user asks for it.
