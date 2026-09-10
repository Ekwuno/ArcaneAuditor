#!/usr/bin/env bash
# Runs `ArcaneAuditorCLI review-app` over one or more paths and merges the
# results into a single JSON report (schema 2.0 plus a "runs" array).
#
# Used by the GitHub Action (action.yml); also works locally:
#
#   ARCANE_PATHS="examples/foo examples/bar" ARCANE_OUTPUT=report.json bash run.sh
#
# Environment:
#   ARCANE_PATHS          Space or newline separated directories, zips, or files
#   ARCANE_CONFIG         Config name or JSON file passed to --config (optional)
#   ARCANE_OUTPUT         Merged report path (default: arcane-report.json)
#   ARCANE_RULES          Comma-separated rule ids to run (optional)
#   ARCANE_EXCLUDE_RULES  Comma-separated rule ids to skip (optional)
#   ARCANE_FILES          Comma-separated file globs passed to --files (optional)
#   ARCANE_BIN            Binary to use (default: ArcaneAuditorCLI on PATH)
#
# Exit code is always 0; the caller decides what to do with the counts. Runs
# that fail with a usage or runtime error (exit 2 or 3) are recorded as a
# synthetic ACTION finding with rule id "ArcaneAuditorError" so nothing is lost
# silently. A path with no Arcane-relevant files is recorded as skipped.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="${ARCANE_BIN:-ArcaneAuditorCLI}"
output="${ARCANE_OUTPUT:-arcane-report.json}"

if [ -z "${ARCANE_PATHS:-}" ]; then
  echo "run.sh: ARCANE_PATHS is empty" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

args=(--agent)
[ -n "${ARCANE_CONFIG:-}" ] && args+=(--config "$ARCANE_CONFIG")
[ -n "${ARCANE_RULES:-}" ] && args+=(--rules "$ARCANE_RULES")
[ -n "${ARCANE_EXCLUDE_RULES:-}" ] && args+=(--exclude-rules "$ARCANE_EXCLUDE_RULES")
[ -n "${ARCANE_FILES:-}" ] && args+=(--files "$ARCANE_FILES")

i=0
manifest="$work/manifest.tsv"
: > "$manifest"

# Split on whitespace and newlines.
for p in $(printf '%s\n' "$ARCANE_PATHS" | tr ' ' '\n' | sed '/^$/d'); do
  i=$((i + 1))
  echo "::group::Arcane Auditor: $p"
  if [ ! -e "$p" ]; then
    echo "path does not exist"
    printf '%s\t%s\t%s\t%s\n' "$p" "missing" "" "" >> "$manifest"
    echo "::endgroup::"
    continue
  fi
  if [ -d "$p" ] && ! find "$p" -type f \( -name '*.pmd' -o -name '*.pod' -o -name '*.script' -o -name '*.amd' -o -name '*.smd' -o -name '*.wqlquery' -o -name '*.orchestration' -o -name '*.suborchestration' \) -print -quit | grep -q .; then
    echo "no Extend or Orchestrate files found, skipping"
    printf '%s\t%s\t%s\t%s\n' "$p" "skipped" "" "" >> "$manifest"
    echo "::endgroup::"
    continue
  fi
  "$bin" review-app "$p" "${args[@]}" > "$work/$i.json" 2> "$work/$i.err"
  code=$?
  echo "exit code $code"
  if [ "$code" -ge 2 ]; then
    sed 's/^/  /' "$work/$i.err" | tail -n 20
  fi
  printf '%s\t%s\t%s\t%s\n' "$p" "$code" "$work/$i.json" "$work/$i.err" >> "$manifest"
  echo "::endgroup::"
done

mkdir -p "$(dirname "$output")"
node "$here/merge.mjs" "$manifest" "$output"
