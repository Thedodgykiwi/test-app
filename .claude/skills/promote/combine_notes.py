#!/usr/bin/env python3
"""Combine existing release notes for a promotion past Alpha.

Usage: combine_notes.py <target_ref> <source_ref> <target_stage> <source_stage> [intro_file]

Collects the release notes from every promotion (and pull request merge) on
<source_ref> that <target_ref> doesn't have yet, and merges them into one
set of notes: same sections, duplicate bullets removed. Prints nothing if
there are no notes to reuse. No AI writing involved.
"""
import re
import subprocess
import sys

NAMES = {"main": "Production", "staging": "Staging", "alpha": "Alpha", "dev": "Dev"}
ORDER = ["new", "improved", "fixed", "behind the scenes", "other updates", "good to know"]
FS, RS = "\x1f", "\x1e"


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def key(heading):
    """'### ✨ New' -> 'new' (drop markup and emoji)."""
    return re.sub(r"[^a-z ]", "", heading.lower()).strip()


def parse(notes):
    """Return {section heading: [bullet, ...]} in order of appearance."""
    sections, current = {}, None
    for line in notes.splitlines():
        if line.startswith("### "):
            current = line[4:].strip()
            sections.setdefault(current, [])
        elif current is None:
            continue  # "## What's new in …" heading and summary: not reused
        elif re.match(r"\s*[-*]\s+", line):
            sections[current].append(re.sub(r"^\s*[-*]\s+", "", line).strip())
        elif line.strip() and sections[current]:
            sections[current][-1] += " " + line.strip()  # wrapped bullet
    return sections


def main():
    target_ref, source_ref, target, source = sys.argv[1:5]
    intro_file = sys.argv[5] if len(sys.argv) > 5 else None

    log = git("log", "--reverse", "--first-parent", "--merges",
              f"--format=%B{RS}", f"{target_ref}..{source_ref}")
    merged = {}  # heading -> bullets
    headings = {}  # normalised key -> heading as first written
    for body in filter(None, (b.strip() for b in log.split(RS))):
        subject, _, rest = body.partition("\n")
        if subject.startswith("Promote ") and "Release notes:" in rest:
            notes = rest.split("Release notes:", 1)[1].split("Changes included:", 1)[0]
            sections = parse(notes)
        elif subject.startswith("Merge pull request"):
            lines = [l.strip() for l in rest.splitlines() if l.strip()]
            sections = {"📦 Other updates": lines} if lines else {}
        else:
            continue
        for heading, bullets in sections.items():
            k = key(heading)
            headings.setdefault(k, heading)
            existing = merged.setdefault(k, [])
            for b in bullets:
                if b not in existing:
                    existing.append(b)

    if not merged:
        return
    keys = sorted(merged, key=lambda k: ORDER.index(k) if k in ORDER else len(ORDER))
    out = [f"## 🚀 What's new in {NAMES.get(target, target)}", ""]
    if intro_file:
        out += [open(intro_file, encoding="utf-8").read().strip(), ""]
    out += [f"This release brings together everything that was tested in "
            f"{NAMES.get(source, source)} since the last update.", ""]
    for k in keys:
        if merged[k]:
            out += [f"### {headings[k]}"] + [f"- {b}" for b in merged[k]] + [""]
    print("\n".join(out).rstrip())


if __name__ == "__main__":
    main()
