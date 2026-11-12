#!/usr/bin/env bash
# Promote one stage to the next and wait for its GitHub Pages deploy.
#   promote.sh status               show commits waiting at each step
#   promote.sh <target> [--dry-run] [--notes-file FILE] [--intro-file FILE]
#       Promote the previous stage into <target>.
#       --notes-file  release notes to use (required for alpha: dev has none)
#       --intro-file  optional extra paragraph placed above reused notes
#   Past alpha, notes are reused automatically from the previous stage.
set -euo pipefail

STAGES=(dev alpha staging main)
REMOTE=origin

die() { echo "ERROR: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"

repo_slug() {
  git remote get-url "$REMOTE" | sed -E 's#(\.git)?$##; s#^.*github\.com[:/]##'
}

previous_stage() {
  local target=$1 i
  for i in "${!STAGES[@]}"; do
    if [[ ${STAGES[$i]} == "$target" ]]; then
      (( i == 0 )) && die "'dev' is the first stage; nothing promotes into it."
      echo "${STAGES[$((i-1))]}"; return
    fi
  done
  die "Unknown stage '$target'. Use one of: ${STAGES[*]:1} (production = main)."
}

stage_url() {
  local slug owner repo
  slug=$(repo_slug); owner=${slug%%/*}; repo=${slug#*/}
  owner=$(echo "$owner" | tr '[:upper:]' '[:lower:]')
  if [[ $1 == main ]]; then echo "https://$owner.github.io/$repo/"
  else echo "https://$owner.github.io/$repo/$1/"; fi
}

pending() {  # commits in $1 not yet in $2 (ignoring promotion merge commits)
  git log --no-merges --format='  %h %s (%an)' "$REMOTE/$2..$REMOTE/$1"
}

git fetch -q "$REMOTE" "${STAGES[@]}"

if [[ ${1:-} == status || -z ${1:-} ]]; then
  for ((i=0; i<${#STAGES[@]}-1; i++)); do
    src=${STAGES[$i]}; dst=${STAGES[$((i+1))]}
    list=$(pending "$src" "$dst")
    if [[ -n $list ]]; then
      echo "$src → $dst: $(echo "$list" | wc -l) commit(s) waiting"; echo "$list"
    else
      echo "$src → $dst: up to date"
    fi
  done
  exit 0
fi

target=$1; shift; [[ $target == production || $target == prod ]] && target=main
dry_run=false; notes_file=; intro_file=
while (( $# )); do
  case $1 in
    --dry-run) dry_run=true ;;
    --notes-file) notes_file=${2:?--notes-file needs a path}; shift ;;
    --intro-file) intro_file=${2:?--intro-file needs a path}; shift ;;
    *) die "Unknown option '$1'" ;;
  esac
  shift
done
[[ -z $notes_file || -s $notes_file ]] || die "Notes file '$notes_file' is missing or empty."
[[ -z $intro_file || -s $intro_file ]] || die "Intro file '$intro_file' is missing or empty."
source=$(previous_stage "$target")

list=$(pending "$source" "$target")
if [[ -z $list ]] && git merge-base --is-ancestor "$REMOTE/$source" "$REMOTE/$target"; then
  echo "Nothing to promote: $target already has everything from $source."; exit 0
fi
echo "Promoting $source → $target. Commits:"
echo "${list:-  (merge commits only)}"

# Past alpha, reuse the notes already written for these changes.
if [[ -z $notes_file && $target != alpha ]]; then
  notes_file=$(mktemp)
  python3 "$(dirname "$0")/combine_notes.py" "$REMOTE/$target" "$REMOTE/$source" \
    "$target" "$source" ${intro_file:+"$intro_file"} > "$notes_file"
  [[ -s $notes_file ]] || die "No release notes found on $source to reuse; pass --notes-file."
  echo; echo "Release notes (reused from $source):"; echo; cat "$notes_file"; echo
fi
[[ -n $notes_file || $dry_run == true ]] || die "Release notes are required when promoting to alpha: pass --notes-file."
$dry_run && { echo "(dry run: nothing changed)"; exit 0; }

[[ -z $(git status --porcelain) ]] || die "Working tree has uncommitted changes; commit or stash them first."

start_branch=$(git branch --show-current)
trap 'git checkout -q "$start_branch" 2>/dev/null || true' EXIT

git checkout -q -B "$target" "$REMOTE/$target"
msg=$(mktemp)
{
  echo "Promote $source → $target"
  echo
  if [[ -n $notes_file ]]; then
    echo "Release notes:"; cat "$notes_file"; echo
  fi
  echo "Changes included:"
  echo "${list:-  (merge commits only)}"
} > "$msg"
if ! git merge -q --no-ff "$REMOTE/$source" -F "$msg"; then
  conflicts=$(git diff --name-only --diff-filter=U)
  git merge --abort
  die "Merge conflict promoting $source → $target in: $conflicts"
fi
sha=$(git rev-parse HEAD)
git push -q "$REMOTE" "$target" 2>&1 | grep -v '^remote:' || true
[[ $(git ls-remote "$REMOTE" "refs/heads/$target" | cut -f1) == "$sha" ]] || die "Push to $target failed."
echo "Pushed $target at ${sha:0:7}. Waiting for deploy…"

api="https://api.github.com/repos/$(repo_slug)/actions/runs?branch=$target&head_sha=$sha&per_page=1"
for _ in $(seq 1 36); do  # up to ~6 minutes
  sleep 10
  read -r status conclusion url < <(curl -fsS "$api" 2>/dev/null | python3 -c '
import json, sys
runs = json.load(sys.stdin).get("workflow_runs", [])
r = runs[0] if runs else {}
print(r.get("status", "none"), r.get("conclusion") or "-", r.get("html_url", "-"))' 2>/dev/null || echo "unreachable - -")
  if [[ $status == completed ]]; then
    if [[ $conclusion == success ]]; then
      echo "Deploy succeeded: $(stage_url "$target")"; exit 0
    fi
    die "Deploy finished with '$conclusion': $url"
  fi
done
die "Timed out waiting for the deploy. Check the Actions tab on GitHub."
