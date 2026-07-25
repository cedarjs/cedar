#!/usr/bin/env bash
#
# Run an Nx command in CI, capturing enough on failure to tell an ordinary Nx
# failure apart from the intermittent Windows one where Nx exits with code 1
# and prints nothing at all.
#
# Usage:
#   bash .github/scripts/run-nx.sh yarn build --output-style=stream
#   bash .github/scripts/run-nx.sh yarn test-ci --maxWorkers=4
#
# On failure it always dumps the package.json diagnostics. If Nx also failed to
# print its run summary it emits a warning annotation and retries once with Nx
# Cloud disabled, to collect data on whether the cloud task runner is involved.

set -uo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: run-nx.sh <command> [args...]" >&2
  exit 2
fi

WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"
LOG_DIR="${RUNNER_TEMP:-/tmp}"
LOG_FILE="$LOG_DIR/nx-output.log"
RETRY_LOG_FILE="$LOG_DIR/nx-output-retry.log"

# Merge stderr into stdout before anything else gets a chance to drop it. The
# failures we are chasing produce no output whatsoever, and we want to be sure
# that is Nx being silent rather than the runner losing the stderr stream (the
# steps that failed ran under both bash and pwsh, so neither is ruled out).
"$@" 2>&1 | tee "$LOG_FILE"
EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

echo "::group::package.json diagnostics"
node "$WORKSPACE/.github/scripts/diagnose-package-json.mjs" || true
echo "::endgroup::"

# Nx prints a closing banner whenever it finishes a run - "Successfully ran
# target <t> for N projects" or "Running target <t> for N projects failed",
# followed by "Failed tasks:". A missing banner means Nx went away instead of
# reporting, which is the bug we are characterising. Gating the retry on this
# keeps ordinary red builds from paying for a second full run.
NX_FINISHED='Successfully ran target|projects? failed|Failed tasks:'

if grep -qE "$NX_FINISHED" "$LOG_FILE"; then
  exit "$EXIT_CODE"
fi

echo "::warning::Nx exited with code $EXIT_CODE without printing a run summary. Retrying once with Nx Cloud disabled to see whether the cloud task runner is involved."

NX_NO_CLOUD=true NX_VERBOSE_LOGGING=true "$@" 2>&1 | tee "$RETRY_LOG_FILE"
RETRY_EXIT_CODE=$?

if [ "$RETRY_EXIT_CODE" -eq 0 ]; then
  echo "::warning::Retry with NX_NO_CLOUD=true passed where the cached run died silently. One data point for the Nx Cloud task runner theory - it takes several to mean anything, since this failure is intermittent."
  exit 0
fi

if grep -qE "$NX_FINISHED" "$RETRY_LOG_FILE"; then
  echo "::warning::Retry with NX_NO_CLOUD=true reported a normal Nx failure, so the silent first attempt is still unexplained."
else
  echo "::warning::Retry with NX_NO_CLOUD=true also died silently, so the Nx Cloud task runner is not the cause."
fi

exit "$RETRY_EXIT_CODE"
