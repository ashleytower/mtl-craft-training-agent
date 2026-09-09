#!/usr/bin/env bash
#
# Is Brix actually up, and is it running the code we think it is?
#
# One script rather than several, because the five things below only mean
# something together. A green gateway in front of a dead API answers nothing; a
# live API running last week's bundle answers wrongly; and a committed mirror
# that has drifted from the live profile means the repo is not a record of what
# Brix is.
#
#   1. gateway   the supervised Hermes process for the `beverage` profile
#   2. api       the beverage API's own declared health
#   3. revision  the exact revision that API process has loaded
#   4. mirror    agent/beverage/ vs the live ~/.hermes/profiles/beverage/
#   5. corpus    what the governed corpus holds right now
#
# Exits non-zero if any check fails, so it can gate a release.
#
# Usage:
#   scripts/brix-status.sh
#   scripts/brix-status.sh --expect-revision <40-char-sha>
#
# `--expect-revision` is the one that turns "deployed" into evidence: it fails
# unless the running process reports that exact SHA *from a build stamp*. A
# revision the process could only guess is refused, because a guess is not proof
# that the loaded bundle came from that commit.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${HERMES_BEVERAGE_PROFILE:-$HOME/.hermes/profiles/beverage}"
GATEWAY_LABEL="ai.hermes.gateway-beverage"
API_LABEL="ai.mtlcraft.beverage-api"
API_BASE="${BEVERAGE_API_URL:-http://127.0.0.1:3000}"

EXPECT_REVISION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-revision)
      EXPECT_REVISION="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

FAILURES=0
pass() { printf '  \033[32mPASS\033[0m  %-22s %s\n' "$1" "${2:-}"; }
fail() {
  printf '  \033[31mFAIL\033[0m  %-22s %s\n' "$1" "${2:-}"
  FAILURES=$((FAILURES + 1))
}
info() { printf '        %-22s %s\n' "$1" "${2:-}"; }

# The token is read from the gitignored .env and never printed. Every
# authenticated probe below uses it via a variable, so it cannot reach the
# terminal, a log, or this script's output.
env_value() {
  [ -f "$REPO_ROOT/.env" ] || return 1
  sed -n "s/^$1=//p" "$REPO_ROOT/.env" | head -1
}

echo "Brix status — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo

# ── 1. gateway ───────────────────────────────────────────────────────────────
echo "gateway"
gateway_state="$(launchctl print "gui/$(id -u)/$GATEWAY_LABEL" 2>/dev/null)"
if [ -z "$gateway_state" ]; then
  fail "launchd service" "$GATEWAY_LABEL is not loaded (launchctl print found no such service)"
else
  gateway_pid="$(printf '%s' "$gateway_state" | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -1)"
  if [ -n "$gateway_pid" ]; then
    pass "launchd service" "$GATEWAY_LABEL running, pid $gateway_pid"
  else
    fail "launchd service" "$GATEWAY_LABEL is loaded but has no running pid"
  fi
fi

# The gateway's own view of Telegram. This is the difference between "the
# process is alive" and "Brix can be reached in Telegram", which is the thing
# actually being asked for.
if [ -f "$PROFILE/gateway_state.json" ]; then
  tg="$(python3 - "$PROFILE/gateway_state.json" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("unreadable|")
    sys.exit()
tg = (d.get("platforms") or {}).get("telegram") or {}
print(f"{tg.get('state', 'absent')}|{tg.get('error_message') or ''}")
PY
)"
  tg_state="${tg%%|*}"
  tg_error="${tg#*|}"
  if [ "$tg_state" = "connected" ]; then
    pass "telegram" "connected"
  else
    fail "telegram" "state=$tg_state ${tg_error:+(${tg_error})}"
  fi
else
  fail "telegram" "no gateway_state.json at $PROFILE"
fi

# ── 2 & 3. api and loaded revision ───────────────────────────────────────────
echo
echo "api"
if ! launchctl print "gui/$(id -u)/$API_LABEL" >/dev/null 2>&1; then
  info "launchd service" "$API_LABEL not loaded (API may be running unsupervised)"
fi

health="$(curl -fsS --max-time 10 "$API_BASE/api/hermes/health" 2>/dev/null)"
if [ -z "$health" ]; then
  fail "health" "no response from $API_BASE/api/hermes/health"
  revision=""
  revision_source=""
else
  read -r h_status h_service revision revision_source <<EOF
$(printf '%s' "$health" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(d.get("status", "?"), d.get("hermes_service", "?"),
      d.get("revision") or "-", d.get("revision_source", "?"))
' 2>/dev/null)
EOF
  if [ "$h_status" = "ok" ]; then
    pass "health" "status=ok"
  else
    fail "health" "status=${h_status:-unparseable}"
  fi
  if [ "$h_service" = "enabled" ]; then
    pass "hermes boundary" "enabled"
  else
    fail "hermes boundary" "hermes_service=$h_service — the agent surface is switched off"
  fi
  info "revision" "$revision (source: $revision_source)"
fi

if [ -n "$EXPECT_REVISION" ]; then
  if [ "$revision" = "$EXPECT_REVISION" ] && [ "$revision_source" = "build_stamp" ]; then
    pass "loaded revision" "matches $EXPECT_REVISION from a build stamp"
  elif [ "$revision" = "$EXPECT_REVISION" ]; then
    fail "loaded revision" "sha matches but source is '$revision_source', not 'build_stamp' — not proof"
  else
    fail "loaded revision" "expected $EXPECT_REVISION, running ${revision:-none}"
  fi
fi

# ── 4. mirror ────────────────────────────────────────────────────────────────
echo
echo "mirror"
mirror_ok=1
check_mirror() {
  local committed="$REPO_ROOT/agent/beverage/$1" live="$PROFILE/$2"
  if [ ! -f "$committed" ]; then
    fail "mirror" "missing committed file: agent/beverage/$1"
    mirror_ok=0
  elif [ ! -f "$live" ]; then
    fail "mirror" "missing live file: $live"
    mirror_ok=0
  elif ! diff -q "$committed" "$live" >/dev/null 2>&1; then
    fail "mirror" "drift: agent/beverage/$1 differs from the live profile"
    mirror_ok=0
  fi
}
check_mirror "SOUL.md" "SOUL.md"
check_mirror "skills/formula-scaling/SKILL.md" "skills/beverage/formula-scaling/SKILL.md"
check_mirror "skills/formula-scaling/scripts/beverage.py" "skills/beverage/formula-scaling/scripts/beverage.py"
[ "$mirror_ok" = 1 ] && pass "mirror" "committed agent/beverage matches the live profile"

# ── 5. corpus ────────────────────────────────────────────────────────────────
echo
echo "corpus"
token="$(env_value HERMES_SERVICE_TOKEN)"
if [ -z "${token:-}" ]; then
  fail "corpus" "no HERMES_SERVICE_TOKEN in $REPO_ROOT/.env"
elif [ -z "$health" ]; then
  fail "corpus" "skipped — the API is not answering"
else
  coverage="$(curl -fsS --max-time 20 -H "x-hermes-service-token: $token" \
    "$API_BASE/api/hermes/knowledge/coverage" 2>/dev/null)"
  if [ -z "$coverage" ]; then
    fail "corpus" "coverage route returned nothing"
  else
    summary="$(printf '%s' "$coverage" | python3 -c '
import json, sys
d = json.load(sys.stdin)
c, ch = d.get("course", {}), d.get("chunks", {})
srcs = d.get("sources", [])
with_chunks = sum(1 for s in srcs if (s.get("chunks") or 0) > 0)
print(f"{len(srcs)} sources ({with_chunks} with passages, "
      f"{len(srcs) - with_chunks} citation-only), "
      f"{ch.get(\"total\", \"?\")} passages, "
      f"{ch.get(\"local_transcript\", \"?\")} local-transcript, "
      f"course content {c.get(\"items_with_content\", \"?\")}/{c.get(\"items_total\", \"?\")}, "
      f"unembedded {int(ch.get(\"total\", 0)) - int(ch.get(\"embedded\", 0))}, "
      f"not collected {c.get(\"items_not_collected\", \"?\")}")
' 2>/dev/null)"
    if [ -n "$summary" ]; then
      pass "corpus" "$summary"
    else
      fail "corpus" "coverage response could not be parsed"
    fi
  fi

  formulas="$(curl -fsS --max-time 20 -H "x-hermes-service-token: $token" \
    "$API_BASE/api/hermes/formulas" 2>/dev/null)"
  if [ -z "$formulas" ]; then
    fail "approved formulas" "formulas route returned nothing"
  else
    n="$(printf '%s' "$formulas" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("count","?"))' 2>/dev/null)"
    # One approved formula is the correct, expected state. This reports it; it
    # does not treat "only one" as a failure, because approving another is a
    # human decision and not this script's business.
    pass "approved formulas" "$n approved and scalable"
  fi
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
  exit 0
fi
echo "$FAILURES check(s) failed."
exit 1
