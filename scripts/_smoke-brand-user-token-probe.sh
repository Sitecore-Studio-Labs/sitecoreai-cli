#!/bin/bash
# Isolation test: does the Sitecore brand-ingestion pipeline succeed
# when called with a USER token instead of an automation-client token?
#
# The only doc that has ever processed successfully on this org was
# created by an Auth0 user account (auth0|646bb…), not an automation
# client. Every scai-uploaded doc fails summarization. This probe
# bypasses scai's auth layer entirely and uses a user-supplied JWT
# so we can isolate the auth dimension.
#
# Usage:
#   1. Open Sitecore Stream in your browser, make sure you're logged in.
#   2. Open DevTools → Network tab.
#   3. Click anything that triggers an API call to edge-platform.sitecorecloud.io
#      (e.g. open a brand kit, list documents, etc.).
#   4. Find the request, copy the `Authorization` header value (just the
#      JWT after "Bearer ", starts with eyJ…).
#   5. Export it as SCAI_USER_TOKEN and run this script:
#        export SCAI_USER_TOKEN='eyJ...'
#        ./scripts/_smoke-brand-user-token-probe.sh
#
# Output: kit creation, doc upload, pipeline trigger, then polls
# document status every 20s for up to 10 min. If status reaches
# `processed` we've confirmed user-token auth fixes summarization. If
# it still hits `failed`, the bug is not auth-related.
set -euo pipefail

if [ -z "${SCAI_USER_TOKEN:-}" ]; then
  echo "ERROR: SCAI_USER_TOKEN not set." >&2
  echo "Capture a user JWT from your Sitecore Stream browser session." >&2
  echo "See the header of this script for instructions." >&2
  exit 2
fi

ORG_ID="${SCAI_ORG_ID:-org_Sqg9NOB4DhDdpb1x}"
# Use the working Sync kit's MMS URL as the source — same PDF that
# successfully processed on Feb 26. Isolates content as a variable.
PDF_URL="${SCAI_PROBE_PDF_URL:-https://mms-delivery.sitecorecloud.io/api/media/v1/delivery/protected/51dc49458fd14210a786e0271b8c5caa}"
POLL_INTERVAL_SEC="${SCAI_POLL_INTERVAL_SEC:-20}"
TIMEOUT_SEC="${SCAI_TIMEOUT_SEC:-600}"

H_AUTH="Authorization: Bearer $SCAI_USER_TOKEN"
H_ACCEPT="Accept: application/json"
H_CT_JSON="Content-Type: application/json"
H_CT_FORM="Content-Type: application/x-www-form-urlencoded"

EDGE="https://edge-platform.sitecorecloud.io"
BRANDS="$EDGE/stream/ai-brands-api"
DOCS="$EDGE/stream/ai-document-api"
PIPELINE="$EDGE/stream/ai-pipeline-api"

KIT_NAME="scai-user-token-probe-$(date +%s)"

echo "==== USER TOKEN PROBE ===="
echo "Org:       $ORG_ID"
echo "PDF URL:   $PDF_URL"
echo "Kit name:  $KIT_NAME"
echo "Token len: ${#SCAI_USER_TOKEN}"
echo ""

# Decode JWT 'sub' claim to confirm we got a user token, not an automation client.
PAYLOAD=$(echo "$SCAI_USER_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null || echo "$SCAI_USER_TOKEN" | cut -d. -f2 | base64 -D 2>/dev/null || true)
SUB=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('sub','?'))" 2>/dev/null || echo "?")
SCOPES=$(echo "$PAYLOAD" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('scope','?'))" 2>/dev/null || echo "?")
echo "Token sub: $SUB"
echo "Scopes:    $SCOPES"
echo ""

if [[ "$SUB" == *"@clients" ]]; then
  echo "WARNING: token 'sub' ends with @clients — this looks like an" >&2
  echo "automation-client token, not a user token. Continuing anyway." >&2
  echo "" >&2
fi

# 1. CREATE kit
echo "[1/5] Creating brand kit..."
KIT_RESPONSE=$(curl -sS -X POST "$BRANDS/api/brands/v1/organizations/$ORG_ID/brandkits" \
  -H "$H_AUTH" -H "$H_CT_JSON" -H "$H_ACCEPT" \
  -d "{\"name\":\"$KIT_NAME\",\"brandName\":\"$KIT_NAME\",\"description\":\"user-token probe\"}")
KIT_ID=$(echo "$KIT_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id',''))")
if [ -z "$KIT_ID" ]; then
  echo "ERROR: kit create failed: $KIT_RESPONSE" >&2
  exit 7
fi
echo "      ok — kitId=$KIT_ID"
echo ""

# 2. UPLOAD doc via v2 form-urlencoded
echo "[2/5] Uploading doc via URL..."
CREATE_REQ="{\"url\":\"$PDF_URL\",\"setMetadata\":true,\"type\":\"brand guidelines\",\"fileType\":\"application/pdf\",\"tags\":[],\"references\":[{\"type\":\"brandkit\",\"id\":\"$KIT_ID\",\"path\":\"/api/brands/v1/organizations/$ORG_ID/brandkits/$KIT_ID/references\"}]}"
DOC_RESPONSE=$(curl -sS -X POST "$DOCS/api/documents/v2/organizations/$ORG_ID/documents" \
  -H "$H_AUTH" -H "$H_CT_FORM" -H "$H_ACCEPT" \
  --data-urlencode "create_request=$CREATE_REQ")
DOC_ID=$(echo "$DOC_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id',''))")
if [ -z "$DOC_ID" ]; then
  echo "ERROR: upload failed: $DOC_RESPONSE" >&2
  exit 7
fi
echo "      ok — documentId=$DOC_ID"
echo ""

# 3. TRIGGER pipeline
echo "[3/5] Triggering brand ingestion pipeline..."
PIPELINE_RESPONSE=$(curl -sS -X POST "$PIPELINE/api/data/v1/organizations/$ORG_ID/pipeline/BrandIngestionPipeline" \
  -H "$H_AUTH" -H "$H_CT_JSON" -H "$H_ACCEPT" \
  -d "{\"parameters\":{\"brand_kit_id\":\"$KIT_ID\",\"populateSections\":true,\"documentIdsList\":\"$DOC_ID\"}}")
RUN_ID=$(echo "$PIPELINE_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id',''))")
echo "      ok — runId=$RUN_ID"
echo ""

# 4. POLL
echo "[4/5] Polling document status every ${POLL_INTERVAL_SEC}s (timeout ${TIMEOUT_SEC}s)..."
START=$(date +%s)
DEADLINE=$((START + TIMEOUT_SEC))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  DOC=$(curl -sS "$DOCS/api/documents/v2/organizations/$ORG_ID/documents/$DOC_ID" -H "$H_AUTH" -H "$H_ACCEPT")
  STATUS=$(echo "$DOC" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(f\"{d.get('status','?')} chunked={d.get('chunked')} summarized={d.get('summarized')}\")")
  ELAPSED=$(($(date +%s) - START))
  printf "      [+%3ds] %s\n" "$ELAPSED" "$STATUS"
  if [[ "$STATUS" == processed* ]]; then
    echo ""
    echo "[5/5] ✅ DOC PROCESSED — user-token auth fixes summarization!"
    # List sections to confirm
    SECTIONS=$(curl -sS "$BRANDS/api/brands/v1/organizations/$ORG_ID/brandkits/$KIT_ID/sections" -H "$H_AUTH" -H "$H_ACCEPT")
    echo "$SECTIONS" | python3 -m json.tool
    exit 0
  fi
  if [[ "$STATUS" == failed* ]]; then
    echo ""
    echo "[5/5] ❌ FAILED with user token too — auth is NOT the issue."
    echo ""
    echo "Full doc record:"
    echo "$DOC" | python3 -m json.tool
    exit 8
  fi
  sleep "$POLL_INTERVAL_SEC"
done
echo ""
echo "[5/5] TIMEOUT after ${TIMEOUT_SEC}s — doc didn't reach a terminal status."
exit 9
