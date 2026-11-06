#!/usr/bin/env bash
#
# P0 verification spike — WhatsApp Business Account (WABA) Graph API field probe.
#
# WHY THIS EXISTS
#   Before building the P3 pricing/analytics dashboard we must confirm, against a
#   REAL client WABA, what Meta's Graph API actually returns — in particular
#   whether pricing_analytics `cost` comes back null (it does for accounts billed
#   through a BSP / Solution Partner). If `cost` is null, P3 can only show an
#   ESTIMATE, not Meta's actual spend. See docs/spikes/p0-waba-graph-api-verification.md
#
# WHAT IT DOES
#   Runs the 8 probe calls read-only (call #8's POST is OPT-IN only). It does NOT
#   send messages or mutate anything unless you explicitly set RUN_SUBSCRIBE_POST=1.
#
# USAGE
#   export TOKEN='EAA...'            # a whatsapp_business_management user/system-user token
#   export WABA_ID='1234567890'      # the client's WhatsApp Business Account id
#   export PHONE_NUMBER_ID='...'     # (optional) a phone number id under that WABA
#   export APP_ID='...'              # (optional) your Meta app id, for call #8 context
#   export GRAPH_VERSION='v21.0'     # (optional) matches backend; try v23.0 to probe newest fields
#   bash scripts/waba-p0-verify.sh
#
#   Output goes to stdout AND to ./p0-results/<timestamp>/ as one JSON file per call.
#
# NOTES
#   - The token is sent as an Authorization: Bearer header. If you run this inside
#     an agent sandbox whose proxy injects the credential for graph.facebook.com,
#     leave TOKEN unset (or set to a placeholder) and the proxy supplies the real one.
#   - start/end are Unix timestamps. Defaults: last 30 days (and last ~95 days for
#     the MONTHLY probe).

set -uo pipefail

GRAPH_VERSION="${GRAPH_VERSION:-v21.0}"
BASE="https://graph.facebook.com/${GRAPH_VERSION}"
TOKEN="${TOKEN:-PLACEHOLDER_TOKEN}"
WABA_ID="${WABA_ID:-}"
PHONE_NUMBER_ID="${PHONE_NUMBER_ID:-}"
APP_ID="${APP_ID:-}"
RUN_SUBSCRIBE_POST="${RUN_SUBSCRIBE_POST:-0}"

if [[ -z "$WABA_ID" ]]; then
  echo "ERROR: WABA_ID is required. export WABA_ID=... first." >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
OUTDIR="p0-results/${TS}"
mkdir -p "$OUTDIR"

# Time windows (Unix seconds)
NOW="$(date +%s)"
D30="$(( NOW - 30*24*3600 ))"
D95="$(( NOW - 95*24*3600 ))"

pp() { # pretty-print JSON from stdin; fall back to raw if not JSON
  if command -v jq >/dev/null 2>&1; then jq . 2>/dev/null || cat; else python3 -m json.tool 2>/dev/null || cat; fi
}

# call <label> <GET|POST> <path-and-query-without-base> [post-body-json]
call() {
  local label="$1" method="$2" path="$3" body="${4:-}"
  local file="${OUTDIR}/${label}.json"
  echo ""
  echo "=================================================================="
  echo "### ${label}  [${method}]  (${GRAPH_VERSION})"
  echo "GET/POST ${path}"
  echo "------------------------------------------------------------------"
  local http
  if [[ "$method" == "POST" ]]; then
    http=$(curl -sS -o "$file" -w '%{http_code}' -X POST \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
      ${body:+--data "$body"} "${BASE}${path}")
  else
    # -G + --data-urlencode handles encoding of the field-expansion string
    http=$(curl -sS -G -o "$file" -w '%{http_code}' \
      -H "Authorization: Bearer ${TOKEN}" \
      --data-urlencode "fields=${path#*\?fields=}" \
      "${BASE}${path%%\?*}")
  fi
  echo "HTTP ${http}"
  pp < "$file"
  echo "   -> saved: ${file}"
}

echo "WABA P0 verification — WABA_ID=${WABA_ID} version=${GRAPH_VERSION} out=${OUTDIR}"

# ---------------------------------------------------------------------------
# 1) pricing_analytics with metric_types(COST,VOLUME)  <-- MOST CRITICAL
#    Confirms whether `cost` is present/null for this account.
# ---------------------------------------------------------------------------
call "01_pricing_analytics_cost_volume" GET \
"/${WABA_ID}?fields=pricing_analytics.start(${D30}).end(${NOW}).granularity(DAILY).metric_types([\"COST\",\"VOLUME\"]).dimensions([\"COUNTRY\",\"PRICING_CATEGORY\",\"PRICING_TYPE\"])"

# ---------------------------------------------------------------------------
# 2) dimensions includes TIER (Meta requires TIER + PRICING_CATEGORY + COUNTRY
#    together for volume-tier info). Confirms TIER is accepted.
# ---------------------------------------------------------------------------
call "02_pricing_analytics_tier_dimension" GET \
"/${WABA_ID}?fields=pricing_analytics.start(${D30}).end(${NOW}).granularity(DAILY).metric_types([\"VOLUME\"]).dimensions([\"TIER\",\"PRICING_CATEGORY\",\"COUNTRY\"])"

# ---------------------------------------------------------------------------
# 3) granularity(MONTHLY) valid?  (wider window so a monthly bucket exists)
# ---------------------------------------------------------------------------
call "03_pricing_analytics_monthly" GET \
"/${WABA_ID}?fields=pricing_analytics.start(${D95}).end(${NOW}).granularity(MONTHLY).metric_types([\"COST\",\"VOLUME\"])"

# ---------------------------------------------------------------------------
# 4) conversation_analytics — still present, or gone/empty under per-message pricing?
# ---------------------------------------------------------------------------
call "04_conversation_analytics" GET \
"/${WABA_ID}?fields=conversation_analytics.start(${D30}).end(${NOW}).granularity(DAILY).dimensions([\"CONVERSATION_CATEGORY\",\"CONVERSATION_TYPE\"])"

# ---------------------------------------------------------------------------
# 5) analytics — sent/delivered confirmation
# ---------------------------------------------------------------------------
call "05_analytics_sent_delivered" GET \
"/${WABA_ID}?fields=analytics.start(${D30}).end(${NOW}).granularity(DAY)"

# ---------------------------------------------------------------------------
# 6) WABA scalar fields
# ---------------------------------------------------------------------------
call "06_waba_fields" GET \
"/${WABA_ID}?fields=id,name,currency,account_review_status,business_verification_status,health_status,country,timezone_id,message_template_namespace"

# ---------------------------------------------------------------------------
# 7) phone_numbers — new field vs deprecated field, side by side.
#    `messaging_limit_tier` is DEPRECATED; `whatsapp_business_manager_messaging_limit`
#    is the replacement. Requesting both shows which one this version honors.
# ---------------------------------------------------------------------------
call "07_phone_numbers_limits" GET \
"/${WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,throughput,messaging_limit_tier,whatsapp_business_manager_messaging_limit"

# ---------------------------------------------------------------------------
# 8) subscribed_apps — GET always; POST only when RUN_SUBSCRIBE_POST=1 (MUTATES!)
# ---------------------------------------------------------------------------
call "08a_subscribed_apps_get" GET \
"/${WABA_ID}/subscribed_apps?fields=whatsapp_business_api_data,override_callback_uri"

if [[ "$RUN_SUBSCRIBE_POST" == "1" ]]; then
  echo ""
  echo "!!! RUN_SUBSCRIBE_POST=1 — issuing POST /subscribed_apps (this SUBSCRIBES the app) !!!"
  call "08b_subscribed_apps_post" POST "/${WABA_ID}/subscribed_apps"
else
  echo ""
  echo "### 08b_subscribed_apps_post  [SKIPPED] — set RUN_SUBSCRIBE_POST=1 to run the mutating POST."
fi

# ---------------------------------------------------------------------------
# Summary: the one answer P3 hinges on
# ---------------------------------------------------------------------------
echo ""
echo "=================================================================="
echo "### SUMMARY — is pricing_analytics.cost usable?"
if command -v jq >/dev/null 2>&1; then
  COSTVALS=$(jq -r '
    .. | objects
    | select(has("cost"))
    | .cost' "${OUTDIR}/01_pricing_analytics_cost_volume.json" 2>/dev/null | sort -u | tr '\n' ' ')
  ERRMSG=$(jq -r '.error.message // empty' "${OUTDIR}/01_pricing_analytics_cost_volume.json" 2>/dev/null)
  if [[ -n "$ERRMSG" ]]; then
    echo "  call #1 returned an ERROR: $ERRMSG"
    echo "  -> If it says cost is not available, this account is billed via a BSP/Solution Partner."
    echo "     P3 can show VOLUME + ESTIMATED cost only (apply your own rate card), not Meta's actual cost."
  elif [[ -z "$COSTVALS" ]]; then
    echo "  No 'cost' key found in the response data points."
    echo "  -> Treat cost as UNAVAILABLE for this account. P3 = estimate only."
  else
    echo "  'cost' values observed: $COSTVALS"
    echo "  -> If all null/empty: estimate only. If real numbers: P3 can show Meta's actual cost."
  fi
else
  echo "  (install jq for the auto-summary; inspect ${OUTDIR}/01_pricing_analytics_cost_volume.json manually)"
fi
echo "=================================================================="
echo "All raw responses saved under ${OUTDIR}/"
