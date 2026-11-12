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

   Summarise the commits that will move. Then:
   - **Target `alpha`:** write release notes (step 4) and show the draft.
   - **Target `staging` or `main`:** the dry run prints release notes the
     script has **reused** from the previous stage's promotions (combined,
     grouped by section, duplicates removed). Don't rewrite them — that's
     what keeps notes identical across stages and saves effort. Skim them
     for wording that only fits an earlier stage (e.g. "Alpha is pink"); if
     you find any, save a corrected copy and pass it with `--notes-file`,
     telling the user exactly what you changed. Show them
     and ask if the user wants a short extra intro (e.g. "🎉 First public
     release!"); if so, save it to a file and pass `--intro-file`.

   Then **ask the user to confirm**, unless they already clearly asked for
   this specific promotion in their current message. Promotion to `main`
   (Production) always needs an explicit "yes" for that promotion, even if
   they confirmed earlier ones.

4. **Write release notes (alpha only).** Notes are written once, when
   changes first leave Dev, and reused by every later stage. Write them for
   someone who has never written code: a tester, a manager, a customer.
   Read the diffs (`git show <sha>`) so you describe what actually changed,
   not just the commit subjects.

   **Format** (Markdown, in this order, leaving out empty sections):

       ## 🚀 What's new in <Stage name>

       <One friendly sentence summing up this release.>

       ### ✨ New
       - **<Short headline>** — what you can now do and why it's useful.

       ### 🛠️ Improved
       - **<Short headline>** — what's better than before.

       ### 🐛 Fixed
       - **<Short headline>** — what went wrong before, and that it's now fixed.

       ### 🔧 Behind the scenes
       - <Changes users won't see, in one or two plain bullets.>

       ### 💡 Good to know
       - <Anything the reader should do or expect, e.g. "refresh the page".>

   **Writing rules:**
   - Describe what the reader **sees or can do**, not how it was built.
     "The page now loads the latest colours straight away" — not
     "Appended commit SHA to asset URLs".
   - **Explain any concept** they might not know in a short, everyday
     phrase in brackets, or with a comparison. E.g. "your browser's cache
     (a stash of files it keeps so pages open faster)".
   - No jargon without an explanation: commit, branch, merge, CSS, cache,
     deploy, API and so on. Prefer everyday words: "update", "release",
     "styling", "this version".
   - Use emoji as signposts: one at the start of each heading, and only
     occasionally in a bullet where it genuinely helps. Never decorate
     every line.
   - Keep it short: one or two sentences per bullet, friendly and positive,
     no blame. Group tiny related changes into one bullet.
   - Use the stage's display name in the heading: Dev, Alpha, Staging, or
     Production (for `main`). **Only the heading may name a stage.** The
     notes are reused unchanged for Staging and Production, so bullets must
     read correctly on every stage: write "each stage has its own colour",
     not "Alpha is pink"; "in this version", not "now on Alpha".

   **Example:**

       ## 🚀 What's new in Alpha

       This update makes sure you always see the newest version of the app,
       and adds a quicker way for the team to release updates.

       ### 🐛 Fixed
       - **Old styling after an update** — sometimes, right after a new
         version went live, the page showed new text in old colours. This
         happened because your browser keeps a "cache" (a stash of files it
         saved earlier so pages open faster) and reused an old one. The app
         now tells your browser when a file has changed, so you get the
         latest look straight away.

       ### 🔧 Behind the scenes
       - The team can now move updates from one testing stage to the next
         with a single request, and each release automatically comes with
         notes like these.

       ### 💡 Good to know
       - If something still looks out of date, refresh the page.
         On Windows press **Ctrl+Shift+R**, on Mac **Cmd+Shift+R**.

   Show the draft to the user with the confirmation in step 3 so they can
   edit it, then save the final text to a file in your scratchpad directory.

5. **Promote.** Run one of:

       .claude/skills/promote/promote.sh alpha --notes-file <notes file>
       .claude/skills/promote/promote.sh <staging|main> [--intro-file <intro file>]

   The script merges the previous stage into the target with a merge commit
   whose message is "Promote <source> → <target>", followed by your release
   notes and the list of commits included. It pushes it, and waits for the deploy
   workflow run for that exact commit. Give it a timeout of at least 6 minutes.

6. **Report.** Tell the user whether the deploy succeeded, repeat the release
   notes, mention they can also read them under **📋 What's new** on that
   stage's site (built from these promotions by
   `.github/scripts/release_notes.py` on every deploy), and give the stage
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
