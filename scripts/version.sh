#!/usr/bin/env bash
# The one version AEGIS is released under. `Cargo.toml` states it
# (`[workspace.package]`) and the server reports it from `/api/v1/health` and
# `--version`; the three `package.json` files repeat it. The release workflow
# publishes whatever this prints, once: when that version has no tag yet.
#
#   ./scripts/version.sh              # print it; fails if a manifest disagrees
#   ./scripts/version.sh set 0.2.0    # write it everywhere it is stated
#
# `set` also runs the exporter of contract samples, because two more files
# state the version and neither is edited by hand: Cargo rewrites `Cargo.lock`,
# and `packages/contracts/samples/health.json` is what the server answers.
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGES=(package.json apps/web/package.json packages/contracts/package.json)
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'

cargo_version() {
  awk '
    /^\[/ { section = $0 }
    section == "[workspace.package]" && /^version[ \t]*=/ {
      gsub(/^[^"]*"|".*$/, "")
      print
      exit
    }' Cargo.toml
}

package_version() {
  awk '
    /^  "version": "/ {
      gsub(/^[^:]*: "|".*$/, "")
      print
      exit
    }' "$1"
}

# Rewrites a file through awk, keeping the file itself (and so its mode).
rewrite() {
  local file=$1
  shift
  awk "$@" "$file" >"$file.tmp"
  cat "$file.tmp" >"$file"
  rm "$file.tmp"
}

check() {
  local version found file status=0
  version=$(cargo_version)
  if [[ ! $version =~ $SEMVER ]]; then
    echo "version: Cargo.toml states '$version', which is not MAJOR.MINOR.PATCH[-pre]" >&2
    exit 1
  fi
  for file in "${PACKAGES[@]}"; do
    found=$(package_version "$file")
    if [[ $found != "$version" ]]; then
      echo "version: $file states '$found' and Cargo.toml '$version'. Run: ./scripts/version.sh set $version" >&2
      status=1
    fi
  done
  [[ $status -eq 0 ]] || exit 1
  echo "$version"
}

set_version() {
  local version=$1 file
  if [[ ! $version =~ $SEMVER ]]; then
    echo "version: '$version' is not MAJOR.MINOR.PATCH[-pre]" >&2
    exit 1
  fi
  rewrite Cargo.toml -v version="$version" '
    /^\[/ { section = $0 }
    section == "[workspace.package]" && /^version[ \t]*=/ {
      print "version = \"" version "\""
      next
    }
    { print }'
  for file in "${PACKAGES[@]}"; do
    rewrite "$file" -v version="$version" '
      !done && /^  "version": "/ {
        sub(/"version": "[^"]*"/, "\"version\": \"" version "\"")
        done = 1
      }
      { print }'
  done
  cargo run --quiet -p aegis-server --bin export-contract-samples
  check >/dev/null
  echo "version: $version is now stated everywhere. Commit it; once CI passes on main, v$version is released."
}

case "${1:-}" in
  '') check ;;
  set)
    if [[ $# -ne 2 ]]; then
      echo "usage: ./scripts/version.sh set <version>" >&2
      exit 2
    fi
    set_version "$2"
    ;;
  *)
    echo "usage: ./scripts/version.sh [set <version>]" >&2
    exit 2
    ;;
esac
