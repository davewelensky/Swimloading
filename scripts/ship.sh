#!/usr/bin/env bash
# SwimLoading ship-loop helper.
#   scripts/ship.sh bump    — bump ?v=N cache-bust refs in *.html for every changed .js/.css file
#   scripts/ship.sh verify  — poll the live site until every ?v=N ref in local HTML is being served
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SITE="https://www.swimloading.com"

route_for() {
  case "$1" in
    index.html)   echo "/app" ;;
    welcome.html) echo "/" ;;
    *)            echo "/${1%.html}" ;;
  esac
}

cmd="${1:-}"

case "$cmd" in
  bump)
    changed=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(js|css)$' || true)
    if [ -z "$changed" ]; then
      echo "No changed .js/.css files — nothing to bump."
      exit 0
    fi
    bumped=0
    for asset in $changed; do
      base=$(basename "$asset")
      refs=$(grep -lF "${base}?v=" -- *.html 2>/dev/null || true)
      [ -z "$refs" ] && continue
      for html in $refs; do
        before=$(grep -oE "$(printf '%s' "$base" | sed 's/\./\\./g')\?v=[0-9]+" "$html" | head -1)
        perl -pi -e 's/((?<![A-Za-z0-9._-])\Q'"$base"'\E\?v=)(\d+)/$1.($2+1)/ge' "$html"
        after=$(grep -oE "$(printf '%s' "$base" | sed 's/\./\\./g')\?v=[0-9]+" "$html" | head -1)
        echo "BUMPED  $html: $before -> $after"
        bumped=1
      done
    done
    if [ "$bumped" = 0 ]; then
      echo "Changed .js/.css files have no ?v= references in any HTML — no bump needed."
      echo "(style.css, sw.js and /app carry no-cache headers in vercel.json.)"
    fi
    ;;

  verify)
    fail=0
    for html in *.html; do
      refs=$(grep -oE '[A-Za-z0-9._-]+\.(js|css)\?v=[0-9]+' "$html" 2>/dev/null | sort -u || true)
      [ -z "$refs" ] && continue
      route=$(route_for "$html")
      n=$(printf '%s\n' "$refs" | wc -l | tr -d ' ')
      for attempt in $(seq 1 24); do   # up to ~4 minutes per page
        live=$(curl -sf --max-time 15 "${SITE}${route}?cb=${attempt}$(date +%s)" || true)
        missing=""
        for ref in $refs; do
          # bash substring check — grep -q in a pipe returns 141 under pipefail (SIGPIPE)
          case "$live" in
            *"$ref"*) ;;
            *) missing="$missing $ref" ;;
          esac
        done
        if [ -z "$missing" ]; then
          echo "OK      ${SITE}${route} serves all $n versioned refs from $html"
          break
        fi
        if [ "$attempt" = 24 ]; then
          echo "STALE   ${SITE}${route} still missing:$missing"
          echo "        Check https://vercel.com/davewelensky/swimloading for a failed deployment."
          fail=1
        else
          sleep 10
        fi
      done
    done
    exit $fail
    ;;

  *)
    echo "usage: scripts/ship.sh bump|verify" >&2
    exit 2
    ;;
esac
