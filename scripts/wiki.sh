#!/usr/bin/env bash
# Lays the wiki's source (docs/wiki) out the way the GitHub wiki holds it, in
# a checkout of the wiki's own repository, and shows what changed there. It
# commits and pushes nothing: publishing is a person's decision.
#
#   git clone https://github.com/cleissonbarbosa/csdt.wiki.git ../csdt.wiki
#   ./scripts/wiki.sh ../csdt.wiki
#   git -C ../csdt.wiki add -A
#   git -C ../csdt.wiki commit -m "Update the wiki"
#   git -C ../csdt.wiki push
#
# The wiki's repository exists only once its first page has been saved on
# GitHub (the Wiki tab, "Create the first page"); until then the clone fails.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source="$root/docs/wiki"
target="${1:?usage: scripts/wiki.sh <checkout of the wiki repository>}"

if [ ! -d "$target/.git" ]; then
  echo "not a git checkout: $target" >&2
  exit 1
fi
if ! python3 -B "$root/scripts/test_wiki.py" >/dev/null 2>&1; then
  echo "docs/wiki does not pass scripts/test_wiki.py; run it to see why" >&2
  exit 1
fi

# A wiki page is named by its file, wherever it lies, so the pages of both
# languages sit side by side at the top. A page removed from the source is
# removed from the wiki.
find "$target" -maxdepth 1 -type f -name '*.md' -delete
cp "$source"/en/*.md "$source"/pt-BR/*.md "$source/_Sidebar.md" "$source/_Footer.md" "$target/"
git -C "$target" status --short
