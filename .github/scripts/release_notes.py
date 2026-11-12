#!/usr/bin/env python3
"""Build releases.json for one stage from its git history.

Usage: release_notes.py <repo_dir> <stage> <output.json>

Promoted stages (alpha, staging, main) list each promotion into them, using
the release notes the promote skill writes into the merge commit. Pull
request merges done on GitHub are listed too. Dev has no promotions, so it
lists its most recent changes instead.
"""
import json
import re
import subprocess
import sys

FS, RS = "\x1f", "\x1e"


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True,
                          text=True, check=True).stdout


def bullets_from_changes(text):
    """'  abc1234 Subject (Author)' lines -> '- Subject' bullets."""
    out = []
    for line in text.splitlines():
        m = re.match(r"\s*[0-9a-f]{7,}\s+(.*?)(?:\s+\([^)]*\))?\s*$", line)
        if m:
            out.append(f"- {m.group(1)}")
    return "\n".join(out)


def promotions(repo):
    log = git(repo, "log", "--first-parent", "--merges", "-n", "50",
              f"--format=%h{FS}%cI{FS}%B{RS}")
    releases = []
    for entry in log.split(RS):
        entry = entry.strip("\n")
        if not entry:
            continue
        sha, date, body = entry.split(FS, 2)
        subject, _, rest = body.strip().partition("\n")
        rest = rest.strip()
        promo = re.match(r"Promote (\w+) → (\w+)", subject)
        pr = re.match(r"Merge pull request #(\d+) from \S+?/(\S+)", subject)
        if promo:
            notes = ""
            if "Release notes:" in rest:
                notes = rest.split("Release notes:", 1)[1]
                notes = notes.split("Changes included:", 1)[0].strip()
            if not notes and "Changes included:" in rest:
                notes = bullets_from_changes(rest.split("Changes included:", 1)[1])
            releases.append({"sha": sha, "date": date, "from": promo.group(1),
                             "notes": notes or "- Minor updates"})
        elif pr:
            lines = [l.strip() for l in rest.splitlines() if l.strip()]
            notes = "\n".join(f"- {l}" for l in lines) or "- Minor updates"
            releases.append({"sha": sha, "date": date, "from": pr.group(2),
                             "pr": int(pr.group(1)), "notes": notes})
    return releases


def recent_changes(repo):
    log = git(repo, "log", "--no-merges", "-n", "15", f"--format=%h{FS}%cI{FS}%s")
    return [dict(zip(("sha", "date", "title"), l.split(FS, 2)))
            for l in log.splitlines() if l]


def main():
    repo, stage, out = sys.argv[1:4]
    data = {"stage": stage, "releases": [], "recent": []}
    if stage == "dev":
        data["recent"] = recent_changes(repo)
    else:
        data["releases"] = promotions(repo)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{stage}: {len(data['releases'])} release(s), {len(data['recent'])} recent change(s)")


if __name__ == "__main__":
    main()
