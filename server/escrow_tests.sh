#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:3001"

# -------- helpers --------
pp () { python3 - <<'PY'
import json,sys
try:
  obj=json.load(sys.stdin)
  print(json.dumps(obj,indent=2))
except Exception as e:
  print(sys.stdin.read())
PY
}

jget () { python3 - <<PY
import json,sys
obj=json.load(sys.stdin)
print(obj.get("$1",""))
PY
}

say () { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok  () { printf "✅ %s\n" "$1"; }
bad () { printf "❌ %s\n" "$1"; }

post () {
  local path="$1"
  local data="$2"
  curl -s -X POST "$BASE$path" -H "Content-Type: application/json" -d "$data"
}

# waits until unix timestamp
wait_until () {
  local t="$1"
  while [ "$(date +%s)" -lt "$t" ]; do sleep 2; done
}

# -------- start --------
say "0) Sanity check"
curl -s "$BASE/health" >/dev/null && ok "Server reachable at $BASE" || { bad "Server not reachable"; exit 1; }

PAYER=$(curl -s "$BASE/debug/payer" | python3 -c "import sys,json; print(json.load(sys.stdin)['payerAddress'])")
PAYEE=$(curl -s "$BASE/debug/payee" | python3 -c "import sys,json; print(json.load(sys.stdin)['payeeAddress'])")

echo "PAYER=$PAYER"
echo "PAYEE=$PAYEE"

# -------- EscrowCreate validation tests --------
say "1) EscrowCreate - validation failures"

# 1.1 missing body
RESP=$(post "/escrow/create" '{}'); echo "$RESP" | pp
[[ "$RESP" == *"Missing"* ]] && ok "Create missing fields -> rejected" || bad "Expected missing-fields rejection"

# 1.2 invalid finishAfterUnix (non-numeric)
RESP=$(post "/escrow/create" "{\"payeeAddress\":\"$PAYEE\",\"amountXrp\":\"1\",\"finishAfterUnix\":\"abc\"}"); echo "$RESP" | pp
[[ "$RESP" == *"finishAfterUnix must be a valid number"* ]] && ok "Create non-numeric finishAfterUnix -> rejected" || bad "Expected non-numeric rejection"

# 1.3 cancelAfter <= finishAfter
NOW=$(date +%s)
FINISH=$((NOW+60))
CANCEL=$((NOW+30))
RESP=$(post "/escrow/create" "{\"payeeAddress\":\"$PAYEE\",\"amountXrp\":\"1\",\"finishAfterUnix\":$FINISH,\"cancelAfterUnix\":$CANCEL}"); echo "$RESP" | pp
[[ "$RESP" == *"cancelAfterUnix must be greater"* ]] && ok "Create cancel<=finish -> rejected" || bad "Expected cancel<=finish rejection"

# 1.4 invalid destination address
NOW=$(date +%s)
FINISH=$((NOW+60))
CANCEL=$((NOW+120))
RESP=$(post "/escrow/create" "{\"payeeAddress\":\"notAnAddress\",\"amountXrp\":\"1\",\"finishAfterUnix\":$FINISH,\"cancelAfterUnix\":$CANCEL}"); echo "$RESP" | pp
# XRPL error text varies, so just check ok:false OR has txResult not tesSUCCESS
[[ "$RESP" == *"ok\":false"* || "$RESP" == *"tem"* || "$RESP" == *"invalid"* ]] && ok "Create invalid destination -> rejected" || bad "Expected invalid destination rejection"

# -------- EscrowCreate happy path + Finish tests --------
say "2) EscrowFinish - too early + success"

NOW=$(date +%s)
FINISH=$((NOW+20))     # keep short for testing
CANCEL=$((NOW+60))

CREATE=$(post "/escrow/create" "{\"payeeAddress\":\"$PAYEE\",\"amountXrp\":\"1\",\"finishAfterUnix\":$FINISH,\"cancelAfterUnix\":$CANCEL}")
echo "$CREATE" | pp

TXR=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('txResult',''))")
if [ "$TXR" != "tesSUCCESS" ]; then
  bad "Create failed; cannot continue finish tests"
  exit 1
fi
SEQ=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['offerSequence'])")
ok "Create succeeded (SEQ=$SEQ)"

say "2.1 Finish too early (expected ok:false)"
RESP=$(post "/escrow/finish" "{\"ownerAddress\":\"$PAYER\",\"offerSequence\":$SEQ}"); echo "$RESP" | pp
[[ "$RESP" == *"Too early"* || "$RESP" == *"ok\":false"* ]] && ok "Finish too early -> rejected" || bad "Expected Too early rejection"

say "2.2 Finish after unlock (expected tesSUCCESS)"
wait_until "$FINISH"
RESP=$(post "/escrow/finish" "{\"ownerAddress\":\"$PAYER\",\"offerSequence\":$SEQ}"); echo "$RESP" | pp
[[ "$RESP" == *"tesSUCCESS"* && "$RESP" == *"ok\":true"* ]] && ok "Finish after unlock -> success" || bad "Expected finish success"

say "2.3 Finish again (expected failure: already claimed)"
RESP=$(post "/escrow/finish" "{\"ownerAddress\":\"$PAYER\",\"offerSequence\":$SEQ}"); echo "$RESP" | pp
[[ "$RESP" == *"tecNO_ENTRY"* || "$RESP" == *"Entry not found"* || "$RESP" == *"ok\":false"* ]] && ok "Finish after claimed -> rejected" || bad "Expected already-claimed rejection"

# -------- EscrowCancel tests --------
say "3) EscrowCancel - too early + success"

NOW=$(date +%s)
FINISH2=$((NOW+20))
CANCEL2=$((NOW+40))

CREATE2=$(post "/escrow/create" "{\"payeeAddress\":\"$PAYEE\",\"amountXrp\":\"1\",\"finishAfterUnix\":$FINISH2,\"cancelAfterUnix\":$CANCEL2}")
echo "$CREATE2" | pp

TXR2=$(echo "$CREATE2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('txResult',''))")
if [ "$TXR2" != "tesSUCCESS" ]; then
  bad "Create failed; cannot continue cancel tests"
  exit 1
fi
SEQ2=$(echo "$CREATE2" | python3 -c "import sys,json; print(json.load(sys.stdin)['offerSequence'])")
ok "Create succeeded (SEQ=$SEQ2)"

say "3.1 Cancel too early (expected ok:false)"
RESP=$(post "/escrow/cancel" "{\"ownerAddress\":\"$PAYER\",\"offerSequence\":$SEQ2}"); echo "$RESP" | pp
[[ "$RESP" == *"Too early"* || "$RESP" == *"ok\":false"* ]] && ok "Cancel too early -> rejected" || bad "Expected Too early rejection"

say "3.2 Cancel after unlock (expected tesSUCCESS)"
wait_until "$CANCEL2"
RESP=$(post "/escrow/cancel" "{\"ownerAddress\":\"$PAYER\",\"offerSequence\":$SEQ2}"); echo "$RESP" | pp
[[ "$RESP" == *"tesSUCCESS"* && "$RESP" == *"ok\":true"* ]] && ok "Cancel after unlock -> success" || bad "Expected cancel success"

say "3.3 Cancel again (expected failure: already canceled)"
RESP=$(post "/escrow/cancel" "{\"ownerAddress\":\"$PAYER\",\"offerSequence\":$SEQ2}"); echo "$RESP" | pp
[[ "$RESP" == *"tecNO_ENTRY"* || "$RESP" == *"Entry not found"* || "$RESP" == *"ok\":false"* ]] && ok "Cancel after canceled -> rejected" || bad "Expected already-canceled rejection"

# -------- Cross-role negative tests (optional but useful) --------
say "4) Negative tests (wrong ownerAddress / wrong signer behavior)"

NOW=$(date +%s)
FINISH3=$((NOW+20))
CANCEL3=$((NOW+40))
CREATE3=$(post "/escrow/create" "{\"payeeAddress\":\"$PAYEE\",\"amountXrp\":\"1\",\"finishAfterUnix\":$FINISH3,\"cancelAfterUnix\":$CANCEL3}")
echo "$CREATE3" | pp
TXR3=$(echo "$CREATE3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('txResult',''))")
[ "$TXR3" = "tesSUCCESS" ] || { bad "Create failed; stopping"; exit 1; }
SEQ3=$(echo "$CREATE3" | python3 -c "import sys,json; print(json.load(sys.stdin)['offerSequence'])")
ok "Create succeeded (SEQ=$SEQ3)"

# 4.1 finish with wrong ownerAddress (should fail 'Entry not found' or similar)
RESP=$(post "/escrow/finish" "{\"ownerAddress\":\"$PAYEE\",\"offerSequence\":$SEQ3}"); echo "$RESP" | pp
[[ "$RESP" == *"Entry not found"* || "$RESP" == *"ok\":false"* ]] && ok "Finish with wrong owner -> rejected" || bad "Expected wrong-owner rejection"

# 4.2 cancel with wrong ownerAddress (should fail 'Not owner' or 'Entry not found')
RESP=$(post "/escrow/cancel" "{\"ownerAddress\":\"$PAYEE\",\"offerSequence\":$SEQ3}"); echo "$RESP" | pp
[[ "$RESP" == *"Not owner"* || "$RESP" == *"Entry not found"* || "$RESP" == *"ok\":false"* ]] && ok "Cancel with wrong owner -> rejected" || bad "Expected wrong-owner rejection"

echo
ok "All scripted test cases completed."
