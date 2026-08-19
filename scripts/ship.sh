#!/usr/bin/env bash
# SwimLoading ship-loop helper.
#   scripts/ship.sh bump    — bump ?v=N cache-bust refs in *.html for every changed .js/.css file
#   scripts/ship.sh verify  — poll the live site until every ?v=N ref in local HTML is being served
#   scripts/ship.sh images <file.html> — check every <img src> in an email/page
#                             is a live, absolute https image BEFORE sending
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

  images)
    # Every image in an email must be LIVE before the campaign is sent.
    #
    # A newsletter cannot be recalled. Worse, Gmail fetches each image
    # through its own proxy on first open and CACHES the result — so an
    # image that 404s at send time stays broken for those recipients even
    # after the file is deployed. On 2026-08-19 explore-map.png landed at
    # 12:42 for a send that day: it happened to be in time, and there is no
    # second chance if it is not.
    shift || true
    files="$*"
    if [ -z "$files" ]; then
      echo "usage: scripts/ship.sh images <file.html> [more.html…]" >&2
      echo "       checks every <img src> resolves to a real image on the live site" >&2
      exit 2
    fi
    fail=0
    for html in $files; do
      if [ ! -f "$html" ]; then
        echo "MISSING FILE  $html"; fail=1; continue
      fi
      srcs=$(grep -oE '<img[^>]+src="[^"]+"' "$html" 2>/dev/null \
             | sed -E 's/.*src="([^"]+)".*/\1/' | sort -u || true)
      if [ -z "$srcs" ]; then
        echo "—       $html has no images"; continue
      fi
      for src in $srcs; do
        case "$src" in
          http://*)
            # Many clients refuse mixed/insecure images outright.
            echo "FAIL    $html  $src"
            echo "        not https — some clients will refuse to load it"
            fail=1
            ;;
          https://*)
            read -r code type < <(curl -sI --max-time 20 "$src" \
              | awk 'BEGIN{c="000";t="?"} /^HTTP/{c=$2} tolower($1)=="content-type:"{t=$2} END{print c, t}')
            case "$code:$type" in
              200:image/*)
                echo "ok      $src"
                ;;
              200:*)
                echo "FAIL    $src"
                echo "        returns 200 but content-type is '$type', not an image"
                fail=1
                ;;
              *)
                echo "FAIL    $src"
                echo "        HTTP $code — deploy the image BEFORE sending; Gmail caches the failure"
                fail=1
                ;;
            esac
            ;;
          *)
            # data: URIs are stripped by Gmail; relative paths have no base
            # in an inbox and can never resolve.
            echo "FAIL    $html  $src"
            echo "        not an absolute https URL — an email has no base to resolve it against"
            fail=1
            ;;
        esac
      done
    done
    if [ "$fail" = 0 ]; then
      echo "All images resolve. Safe to send."
    else
      echo "Do NOT send — fix the images above first." >&2
    fi
    exit $fail
    ;;

  *)
    echo "usage: scripts/ship.sh bump|verify|images <file.html>" >&2
    exit 2
    ;;
esac
