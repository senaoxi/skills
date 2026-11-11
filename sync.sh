#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/skills-sync.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

# Keep agent-specific installation files outside the repository.
(
  cd "$work_dir"
  "$repo_dir/node_modules/.bin/skills" add backnotprop/pstack --skill '*' --yes
)

curl --fail --silent --show-error --location --retry 3 \
  https://raw.githubusercontent.com/backnotprop/pstack/main/LICENSE \
  --output "$work_dir/pstack.LICENSE"

# Finish downloading before replacing the current snapshot.
test -s "$work_dir/skills-lock.json"
for skill_dir in "$work_dir/.agents/skills"/*; do
  test -f "$skill_dir/SKILL.md"
done

rm -rf "$repo_dir/skills"
cp -R "$work_dir/.agents/skills" "$repo_dir/skills"
cp "$work_dir/skills-lock.json" "$repo_dir/skills-lock.json"
mkdir -p "$repo_dir/licenses"
cp "$work_dir/pstack.LICENSE" "$repo_dir/licenses/pstack.LICENSE"

cd "$repo_dir"
pnpm run fmt
