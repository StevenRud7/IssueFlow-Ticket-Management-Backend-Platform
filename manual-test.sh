#!/usr/bin/env bash
#
# manual-test.sh — end-to-end smoke walkthrough of the IssueFlow API.
#
# Runs every feature in order against a running instance and prints each
# result. This is a convenience companion to manual-test.md; it is NOT the
# automated test suite (that's `npm test` / `npm run test:e2e`).
#
# Prerequisites:
#   - the app is running        (npm run start:dev)
#   - PostgreSQL is up           (docker compose up -d)
#   - the schema is applied      (npm run migrate)
#
# Usage:
#   bash manual-test.sh
#
# Optional env vars:
#   BASE_URL   API base (default http://localhost:3000)
#   COMPOSE_DB docker compose service name for psql steps (default "db")

set -u
BASE_URL="${BASE_URL:-http://localhost:3000}"
COMPOSE_DB="${COMPOSE_DB:-db}"

# Scratch directory for the test files the upload steps need.
#
# It is created as a RELATIVE path next to wherever the script is run
# (./.manual-test-tmp), not under /tmp. Reasons:
#   - /tmp does not exist on native Windows.
#   - On Git Bash, `curl` is often the native Windows curl.exe, which does
#     not understand Git Bash's POSIX-style absolute paths (/tmp/...) in
#     `-F file=@...`. A relative path like ./.manual-test-tmp/note.txt
#     works for curl on every platform.
# The directory is removed automatically when the script exits.
TMPDIR_TEST="./.manual-test-tmp"
mkdir -p "$TMPDIR_TEST"
cleanup() {
  rm -rf "$TMPDIR_TEST" 2>/dev/null
}
trap cleanup EXIT

pass=0
fail=0

# check <description> <actual-http-code> <expected-http-code>
check() {
  if [ "$2" = "$3" ]; then
    echo "  PASS  $1  (HTTP $2)"
    pass=$((pass + 1))
  else
    echo "  FAIL  $1  (expected $3, got $2)"
    fail=$((fail + 1))
  fi
}

# code_of <curl args...>  → prints just the HTTP status code
code_of() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

# json_of <curl args...>  → prints the response body
json_of() {
  curl -s "$@"
}

# extract a top-level string/number field from a JSON blob without jq
field() {
  # field <json> <key>
  printf '%s' "$1" | sed -n 's/.*"'"$2"'":"\?\([^",}]*\)"\?.*/\1/p' | head -1
}

echo "=================================================="
echo " IssueFlow manual smoke test  —  $BASE_URL"
echo "=================================================="

# --- Preflight: is the app actually reachable? -----------------------------
# Without this, an app that isn't running produces ~30 confusing "got 000"
# FAIL lines. curl exit code 7 == "couldn't connect"; an empty/000 status
# means nothing is listening. Catch that here and explain it clearly.
echo ""
echo "[0] Preflight — checking the app is reachable..."
PREFLIGHT_CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$BASE_URL/health" 2>/dev/null)"
if [ "$PREFLIGHT_CODE" != "200" ]; then
  echo ""
  echo "  ERROR: could not reach the IssueFlow API at $BASE_URL"
  echo "         (GET /health returned '${PREFLIGHT_CODE:-no response}')"
  echo ""
  echo "  This script does NOT start the app — it expects it already running."
  echo "  Check, in order:"
  echo ""
  echo "    1. Is the app running?  In a separate terminal:"
  echo "         npm run start:dev"
  echo "       Leave it running, then re-run this script in another terminal."
  echo ""
  echo "    2. Did the app crash on startup?  Look at the start:dev terminal."
  echo "       A leftover DATABASE_URL from an earlier command is a common"
  echo "       cause — it makes the app target a missing database and exit."
  echo "       Clear it (bash: 'unset DATABASE_URL') or open a fresh terminal."
  echo ""
  echo "    3. Is PostgreSQL up?   docker compose up -d"
  echo "       Is the schema applied?   npm run migrate"
  echo ""
  echo "    4. Wrong port/host?  Override with:  BASE_URL=http://... bash manual-test.sh"
  echo ""
  echo "  Aborting — fix the above and re-run."
  echo "=================================================="
  exit 1
fi
echo "  OK — app responded on $BASE_URL"

# --- 1. Health -------------------------------------------------------------
echo ""
echo "[1] Health"
check "GET /"        "$(code_of "$BASE_URL/")"       200
check "GET /health"  "$(code_of "$BASE_URL/health")" 200

# --- 2. Registration -------------------------------------------------------
echo ""
echo "[2] User registration"

# Usernames are suffixed with a per-run tag so the script is re-runnable
# without first wiping the database — a second run won't collide with the
# users a previous run created (which would 409 and shift the ids).
RUN_TAG="$(date +%H%M%S)$$"
U_ALICE="alice_$RUN_TAG"
U_BOB="bob_$RUN_TAG"
U_CAROL="carol_$RUN_TAG"
U_DAVE="dave_$RUN_TAG"

# reg <username> <fullName> <role>  -> echoes the JSON response body
reg() {
  json_of -X POST "$BASE_URL/users" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"fullName\":\"$2\",\"role\":\"$3\",\"password\":\"password123\"}"
}
# reg_code <username> <fullName> <role>  -> echoes just the HTTP status
reg_code() {
  code_of -X POST "$BASE_URL/users" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"fullName\":\"$2\",\"role\":\"$3\",\"password\":\"password123\"}"
}

ALICE_JSON="$(reg "$U_ALICE" 'Alice Admin' ADMIN)"
ALICE_ID="$(field "$ALICE_JSON" id)"
check "register alice (ADMIN)" \
  "$( [ -n "$ALICE_ID" ] && echo 200 || echo 0 )" 200

BOB_JSON="$(reg "$U_BOB" 'Bob Dev' DEVELOPER)"
BOB_ID="$(field "$BOB_JSON" id)"
check "register bob (DEVELOPER)" \
  "$( [ -n "$BOB_ID" ] && echo 200 || echo 0 )" 200

CAROL_JSON="$(reg "$U_CAROL" 'Carol Dev' DEVELOPER)"
CAROL_ID="$(field "$CAROL_JSON" id)"
check "register carol (DEVELOPER)" \
  "$( [ -n "$CAROL_ID" ] && echo 200 || echo 0 )" 200

check "duplicate username -> 409"  "$(reg_code "$U_ALICE" 'Dup' ADMIN)" 409
check "invalid role -> 400" \
  "$(code_of -X POST "$BASE_URL/users" -H 'Content-Type: application/json' \
     -d "{\"username\":\"bad_$RUN_TAG\",\"email\":\"b@b.com\",\"fullName\":\"B\",\"role\":\"WIZARD\",\"password\":\"password123\"}")" 400
# README contract: password is OPTIONAL — registration without one is 200 OK.
DAVE_JSON="$(json_of -X POST "$BASE_URL/users" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U_DAVE\",\"email\":\"$U_DAVE@example.com\",\"fullName\":\"Dave NoPass\",\"role\":\"DEVELOPER\"}")"
DAVE_ID="$(field "$DAVE_JSON" id)"
check "register WITHOUT password -> 200 (README contract)" \
  "$( [ -n "$DAVE_ID" ] && echo 200 || echo 0 )" 200
# ...and that passwordless user cannot authenticate.
check "passwordless user cannot log in -> 401" \
  "$(code_of -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
     -d "{\"username\":\"$U_DAVE\",\"password\":\"anything\"}")" 401

# --- 3. Auth ---------------------------------------------------------------
echo ""
echo "[3] Authentication"
LOGIN_JSON="$(json_of -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U_ALICE\",\"password\":\"password123\"}")"
TOKEN="$(field "$LOGIN_JSON" accessToken)"
if [ -n "$TOKEN" ]; then
  echo "  PASS  login alice -> token obtained"
  pass=$((pass + 1))
else
  echo "  FAIL  login alice -> no token; aborting"
  exit 1
fi
AUTH="Authorization: Bearer $TOKEN"
check "GET /auth/me"                "$(code_of "$BASE_URL/auth/me" -H "$AUTH")" 200
check "wrong password -> 401" \
  "$(code_of -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
     -d "{\"username\":\"$U_ALICE\",\"password\":\"nope\"}")" 401
check "no token -> 401"             "$(code_of "$BASE_URL/projects")" 401

# --- 3b. User CRUD (authenticated) -----------------------------------------
echo ""
echo "[3b] User management — read / update / delete"
check "GET /users (list)"           "$(code_of "$BASE_URL/users" -H "$AUTH")" 200
check "GET /users/:id (by id)"      "$(code_of "$BASE_URL/users/$ALICE_ID" -H "$AUTH")" 200
check "GET /users/99999 -> 404"     "$(code_of "$BASE_URL/users/99999" -H "$AUTH")" 404
# Update is POST /users/update/:id per the README; only fullName + role.
check "POST /users/update/:id (fullName+role)" \
  "$(code_of -X POST "$BASE_URL/users/update/$BOB_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"fullName":"Bob Senior Dev","role":"ADMIN"}')" 200
# confirm the change persisted
UPDATED_USER="$(json_of "$BASE_URL/users/$BOB_ID" -H "$AUTH")"
if printf '%s' "$UPDATED_USER" | grep -q 'Bob Senior Dev'; then
  echo "  PASS  user update persisted (fullName changed)"
  pass=$((pass + 1))
else
  echo "  FAIL  user update did not persist"
  fail=$((fail + 1))
fi
check "update with invalid role -> 400" \
  "$(code_of -X POST "$BASE_URL/users/update/$BOB_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"role":"WIZARD"}')" 400
# Restore bob to DEVELOPER so later sections have consistent test data
# (the update test above promoted him to ADMIN; auto-assignment in §5 and
# the RBAC check in §12 both expect bob to still be a DEVELOPER).
check "restore bob to DEVELOPER" \
  "$(code_of -X POST "$BASE_URL/users/update/$BOB_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"role":"DEVELOPER"}')" 200
# delete the passwordless user 'dave' (by captured id — not a hardcoded
# number, so this works no matter what the database already contained).
check "DELETE /users/:id (dave)" \
  "$(code_of -X DELETE "$BASE_URL/users/$DAVE_ID" -H "$AUTH")" 200
check "deleted user is gone -> 404" \
  "$(code_of "$BASE_URL/users/$DAVE_ID" -H "$AUTH")" 404

# --- 4. Projects -----------------------------------------------------------
echo ""
echo "[4] Projects"
PROJ_JSON="$(json_of -X POST "$BASE_URL/projects" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Website Revamp\",\"description\":\"Q3 site\",\"ownerId\":$ALICE_ID}")"
PROJECT_ID="$(field "$PROJ_JSON" id)"
check "create project"  "$( [ -n "$PROJECT_ID" ] && echo 200 || echo 0 )" 200
check "list projects"   "$(code_of "$BASE_URL/projects" -H "$AUTH")" 200
check "bad owner -> 404" \
  "$(code_of -X POST "$BASE_URL/projects" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"name":"Bad","description":"x","ownerId":999}')" 404

# --- 5. Tickets + auto-assignment -----------------------------------------
echo ""
echo "[5] Tickets + auto-assignment"
T1_JSON="$(json_of -X POST "$BASE_URL/tickets" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Fix nav bar\",\"type\":\"BUG\",\"projectId\":$PROJECT_ID}")"
T1_ID="$(field "$T1_JSON" id)"
T1_ASSIGNEE="$(field "$T1_JSON" assigneeId)"
check "create ticket 1" "$( [ -n "$T1_ID" ] && echo 200 || echo 0 )" 200
if [ -n "$T1_ASSIGNEE" ] && [ "$T1_ASSIGNEE" != "null" ]; then
  echo "  PASS  ticket 1 auto-assigned to user $T1_ASSIGNEE"
  pass=$((pass + 1))
else
  echo "  FAIL  ticket 1 was not auto-assigned"
  fail=$((fail + 1))
fi
T2_JSON="$(json_of -X POST "$BASE_URL/tickets" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Add dark mode\",\"type\":\"FEATURE\",\"projectId\":$PROJECT_ID}")"
T2_ID="$(field "$T2_JSON" id)"
check "create ticket 2"           "$( [ -n "$T2_ID" ] && echo 200 || echo 0 )" 200
check "GET /projects/:id/workload" "$(code_of "$BASE_URL/projects/$PROJECT_ID/workload" -H "$AUTH")" 200
check "invalid ticket type -> 400" \
  "$(code_of -X POST "$BASE_URL/tickets" -H "$AUTH" -H 'Content-Type: application/json' \
     -d "{\"title\":\"X\",\"type\":\"NONSENSE\",\"projectId\":$PROJECT_ID}")" 400

# --- 6. Lifecycle + optimistic locking ------------------------------------
echo ""
echo "[6] Ticket lifecycle + optimistic locking"
check "TODO -> IN_PROGRESS (v1)" \
  "$(code_of -X PATCH "$BASE_URL/tickets/$T1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"status":"IN_PROGRESS","version":1}')" 200
check "backward transition -> 400" \
  "$(code_of -X PATCH "$BASE_URL/tickets/$T1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"status":"TODO","version":2}')" 400
check "stale version -> 409" \
  "$(code_of -X PATCH "$BASE_URL/tickets/$T1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"title":"stale","version":1}')" 409

# --- 7. Dependencies -------------------------------------------------------
echo ""
echo "[7] Dependencies"
check "add 1 blocked-by 2" \
  "$(code_of -X POST "$BASE_URL/tickets/$T1_ID/dependencies" -H "$AUTH" -H 'Content-Type: application/json' \
     -d "{\"blockedBy\":$T2_ID}")" 200
check "list dependencies" "$(code_of "$BASE_URL/tickets/$T1_ID/dependencies" -H "$AUTH")" 200
check "self-dependency -> 400" \
  "$(code_of -X POST "$BASE_URL/tickets/$T1_ID/dependencies" -H "$AUTH" -H 'Content-Type: application/json' \
     -d "{\"blockedBy\":$T1_ID}")" 400
check "cycle -> 400" \
  "$(code_of -X POST "$BASE_URL/tickets/$T2_ID/dependencies" -H "$AUTH" -H 'Content-Type: application/json' \
     -d "{\"blockedBy\":$T1_ID}")" 400
check "DONE blocked by unresolved blocker -> 409" \
  "$(code_of -X PATCH "$BASE_URL/tickets/$T1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"status":"DONE","version":2}')" 409
check "resolve blocker (ticket 2 -> DONE)" \
  "$(code_of -X PATCH "$BASE_URL/tickets/$T2_ID" -H "$AUTH" -H 'Content-Type: application/json' \
     -d '{"status":"DONE","version":1}')" 200

# --- 8. Comments + mentions ------------------------------------------------
echo ""
echo "[8] Comments + @mentions"
C_JSON="$(json_of -X POST "$BASE_URL/tickets/$T2_ID/comments" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"authorId\":$ALICE_ID,\"content\":\"On it @$U_BOB\"}")"
C_ID="$(field "$C_JSON" id)"
check "create comment with @mention" "$( [ -n "$C_ID" ] && echo 200 || echo 0 )" 200
check "list comments"      "$(code_of "$BASE_URL/tickets/$T2_ID/comments" -H "$AUTH")" 200
check "bob's mention feed" "$(code_of "$BASE_URL/users/$BOB_ID/mentions" -H "$AUTH")" 200

# --- 9. Attachments --------------------------------------------------------
echo ""
echo "[9] Attachments"
echo "hello" > "$TMPDIR_TEST/note.txt"
A_JSON="$(json_of -X POST "$BASE_URL/tickets/$T2_ID/attachments" -H "$AUTH" \
  -F "file=@$TMPDIR_TEST/note.txt;type=text/plain")"
A_ID="$(field "$A_JSON" id)"
check "upload text/plain" "$( [ -n "$A_ID" ] && echo 200 || echo 0 )" 200
echo "x" > "$TMPDIR_TEST/bad.exe"
check "disallowed MIME -> 400" \
  "$(code_of -X POST "$BASE_URL/tickets/$T2_ID/attachments" -H "$AUTH" \
     -F "file=@$TMPDIR_TEST/bad.exe;type=application/x-msdownload")" 400
check "list attachments" "$(code_of "$BASE_URL/tickets/$T2_ID/attachments" -H "$AUTH")" 200
if [ -n "$A_ID" ]; then
  check "delete attachment" \
    "$(code_of -X DELETE "$BASE_URL/tickets/$T2_ID/attachments/$A_ID" -H "$AUTH")" 200
fi

# --- 10. CSV export / import ----------------------------------------------
echo ""
echo "[10] CSV export / import"
check "export CSV" "$(code_of "$BASE_URL/tickets/export?projectId=$PROJECT_ID" -H "$AUTH")" 200
check "export without projectId -> 400" "$(code_of "$BASE_URL/tickets/export" -H "$AUTH")" 400

# Download the CSV to a real file. The API suggests the filename
# "tickets-project-{id}.csv" via its Content-Disposition header; we save
# under that name (inside the scratch dir) to mirror what -OJ / a browser
# would produce.
EXPORT_CSV="$TMPDIR_TEST/tickets-project-${PROJECT_ID}.csv"
curl -s -o "$EXPORT_CSV" "$BASE_URL/tickets/export?projectId=$PROJECT_ID" -H "$AUTH"
if [ -s "$EXPORT_CSV" ]; then
  echo "  PASS  exported CSV saved to disk ($(wc -c < "$EXPORT_CSV" | tr -d ' ') bytes)"
  pass=$((pass + 1))
else
  echo "  FAIL  exported CSV file is missing or empty"
  fail=$((fail + 1))
fi
# §3.4: the header row must be exactly these seven fields, in order.
EXPECTED_HEADER='id,title,description,status,priority,type,assigneeId'
ACTUAL_HEADER="$(head -n 1 "$EXPORT_CSV" 2>/dev/null | tr -d '\r')"
if [ "$ACTUAL_HEADER" = "$EXPECTED_HEADER" ]; then
  echo "  PASS  CSV header has the 7 required fields in order"
  pass=$((pass + 1))
else
  echo "  FAIL  CSV header mismatch"
  echo "        expected: $EXPECTED_HEADER"
  echo "        actual:   $ACTUAL_HEADER"
  fail=$((fail + 1))
fi
# The export should contain at least one ticket data row (header + data).
EXPORT_LINES="$(grep -c . "$EXPORT_CSV" 2>/dev/null || echo 0)"
if [ "$EXPORT_LINES" -ge 2 ]; then
  echo "  PASS  CSV contains $((EXPORT_LINES - 1)) ticket data row(s)"
  pass=$((pass + 1))
else
  echo "  FAIL  CSV has no data rows (only $EXPORT_LINES line(s))"
  fail=$((fail + 1))
fi

cat > "$TMPDIR_TEST/import.csv" << 'CSV'
title,description,status,priority,type,assigneeId
Imported one,from csv,TODO,HIGH,BUG,
Imported two,from csv,IN_PROGRESS,LOW,FEATURE,
,missing title row,,,BUG,
CSV
IMPORT_JSON="$(json_of -X POST "$BASE_URL/tickets/import" -H "$AUTH" \
  -F "file=@$TMPDIR_TEST/import.csv;type=text/csv" -F "projectId=$PROJECT_ID")"
IMPORT_CREATED="$(field "$IMPORT_JSON" created)"
if [ "$IMPORT_CREATED" = "2" ]; then
  echo "  PASS  CSV import created 2 valid rows, rejected the invalid one"
  pass=$((pass + 1))
else
  echo "  FAIL  CSV import: expected created=2, got '$IMPORT_CREATED'"
  fail=$((fail + 1))
fi
# Round-trip check: re-export and confirm an imported ticket is present.
curl -s -o "$EXPORT_CSV" "$BASE_URL/tickets/export?projectId=$PROJECT_ID" -H "$AUTH"
if grep -q 'Imported one' "$EXPORT_CSV" 2>/dev/null; then
  echo "  PASS  re-export includes an imported ticket (round-trip)"
  pass=$((pass + 1))
else
  echo "  FAIL  re-export did not include the imported ticket"
  fail=$((fail + 1))
fi

# --- 11. Auto-escalation ---------------------------------------------------
echo ""
echo "[11] Auto-escalation"
ESC_JSON="$(json_of -X POST "$BASE_URL/tickets" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Overdue soon\",\"type\":\"BUG\",\"projectId\":$PROJECT_ID,\"priority\":\"LOW\",\"dueDate\":\"2999-01-01T00:00:00Z\"}")"
ESC_ID="$(field "$ESC_JSON" id)"
if docker compose exec -T "$COMPOSE_DB" psql -U issueflow -d issueflow \
     -c "UPDATE tickets SET due_date = NOW() - INTERVAL '2 days' WHERE id = $ESC_ID;" > /dev/null 2>&1; then
  check "trigger escalation cycle" \
    "$(code_of -X POST "$BASE_URL/admin/escalation/run" -H "$AUTH")" 200
  AFTER="$(json_of "$BASE_URL/tickets/$ESC_ID" -H "$AUTH")"
  PRIO="$(field "$AFTER" priority)"
  if [ "$PRIO" = "MEDIUM" ]; then
    echo "  PASS  overdue ticket escalated LOW -> MEDIUM"
    pass=$((pass + 1))
  else
    echo "  FAIL  escalation: expected priority MEDIUM, got '$PRIO'"
    fail=$((fail + 1))
  fi
else
  echo "  SKIP  escalation (could not backdate dueDate via docker compose;"
  echo "        run the UPDATE manually — see manual-test.md section 11)"
fi

# --- 12. Soft delete + restore + RBAC -------------------------------------
echo ""
echo "[12] Soft delete + restore"
check "soft-delete ticket 1" "$(code_of -X DELETE "$BASE_URL/tickets/$T1_ID" -H "$AUTH")" 200
check "list deleted (ADMIN)" "$(code_of "$BASE_URL/tickets/deleted?projectId=$PROJECT_ID" -H "$AUTH")" 200
check "restore ticket 1"     "$(code_of -X POST "$BASE_URL/tickets/$T1_ID/restore" -H "$AUTH")" 200
check "restore again -> 409" "$(code_of -X POST "$BASE_URL/tickets/$T1_ID/restore" -H "$AUTH")" 409
# Use carol for the RBAC check — she is registered as a DEVELOPER and is
# never role-changed. (Bob is briefly promoted to ADMIN and back in §3b;
# carol is the unambiguous, stable DEVELOPER subject.)
DEVTOKEN="$(field "$(json_of -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U_CAROL\",\"password\":\"password123\"}")" accessToken)"
check "DEVELOPER on /tickets/deleted -> 403" \
  "$(code_of "$BASE_URL/tickets/deleted?projectId=$PROJECT_ID" -H "Authorization: Bearer $DEVTOKEN")" 403

# --- 13. Audit log ---------------------------------------------------------
echo ""
echo "[13] Audit log"
check "GET /audit-logs"                "$(code_of "$BASE_URL/audit-logs" -H "$AUTH")" 200
check "filter entityType=TICKET"        "$(code_of "$BASE_URL/audit-logs?entityType=TICKET" -H "$AUTH")" 200
check "filter action=AUTO_ASSIGN"       "$(code_of "$BASE_URL/audit-logs?action=AUTO_ASSIGN" -H "$AUTH")" 200
check "invalid filter enum -> 400"      "$(code_of "$BASE_URL/audit-logs?action=BOGUS" -H "$AUTH")" 400

# --- 14. Logout ------------------------------------------------------------
echo ""
echo "[14] Logout"
check "POST /auth/logout"            "$(code_of -X POST "$BASE_URL/auth/logout" -H "$AUTH")" 200
check "token deny-listed after logout -> 401" \
  "$(code_of "$BASE_URL/auth/me" -H "$AUTH")" 401

# --- summary ---------------------------------------------------------------
echo ""
echo "=================================================="
echo " RESULT:  $pass passed,  $fail failed"
echo "=================================================="
[ "$fail" -eq 0 ] && exit 0 || exit 1