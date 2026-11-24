#!/usr/bin/env bash
# States master, state assignment per sales person, and the lead list each of
# them gets as a result.
set -uo pipefail
cd "$(dirname "$0")/../server"

ADMIN_U=$(grep -E '^ADMIN_USER=' .env | cut -d= -f2-)
ADMIN_P=$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
WEB=http://127.0.0.1:9002
APP=http://127.0.0.1:9001/api/app
BACK=http://127.0.0.1:9001
JAR=$(mktemp)
PW='states-test-4k9'

fails=0
check() {
  if [ "$2" = "1" ]; then printf '  PASS  %s\n' "$1"
  else printf '  FAIL  %s   %s\n' "$1" "${3:-}"; fails=$((fails+1)); fi
}
has() { echo "$1" | grep -qF "$2" && echo 1 || echo 0; }
hasnt() {
  if [ "$(has "$1" '"error"')" = "1" ]; then echo 0; return; fi   # an error is not an answer
  if [ "$(has "$1" '"data"')" = "0" ]; then echo 0; return; fi    # nor is an empty body
  [ "$(has "$1" "$2")" = "0" ] && echo 1 || echo 0
}
# The first id on the line. A user now carries its states, each with an id of
# its own, so a greedy match would pick up the wrong one.
id_of() { echo "$1" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2; }

awebg() { curl -s -b "$JAR" "$WEB/api/admin$1"; }
awebp() { curl -s -b "$JAR" -X "${3:-POST}" -H 'Content-Type: application/json' \
            -H 'X-Requested-With: visbot-admin' -d "$2" "$WEB/api/admin$1"; }
awebd() { curl -s -b "$JAR" -X DELETE -H 'X-Requested-With: visbot-admin' "$WEB/api/admin$1"; }
applogin() { curl -s -X POST -H 'Content-Type: application/json' \
               -d "{\"identifier\":\"$1\",\"password\":\"$PW\"}" "$APP/login" \
             | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
appg() { curl -s -H "Authorization: Bearer $1" "$APP$2"; }

curl -s -c "$JAR" -X POST -H 'Content-Type: application/json' -H 'X-Requested-With: visbot-admin' \
  -d "{\"identifier\":\"$ADMIN_U\",\"password\":\"$ADMIN_P\"}" "$WEB/api/admin/login" > /dev/null

echo "== 1. the states master"
states=$(awebg /states)
check "all 36 states and union territories are there" \
  "$([ "$(echo "$states" | grep -o '"code"' | wc -l | tr -d ' ')" = "36" ] && echo 1 || echo 0)" \
  "$(echo "$states" | grep -o '"code"' | wc -l)"
check "Tamil Nadu is one of them" "$(has "$states" '"name":"Tamil Nadu"')" ""
check "union territories are marked as such" "$(has "$states" '"kind":"union territory"')" ""
check "each carries its code" "$(has "$states" '"code":"TN"')" ""
check "and how many leads sit in it" "$(has "$states" 'lead_count')" ""

TN=$(echo "$states" | python3 -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["data"] if s["code"]=="TN"][0])')
KL=$(echo "$states" | python3 -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["data"] if s["code"]=="KL"][0])')
KA=$(echo "$states" | python3 -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["data"] if s["code"]=="KA"][0])')
check "ids came back for TN, KL and KA" "$([ -n "$TN" ] && [ -n "$KL" ] && [ -n "$KA" ] && echo 1 || echo 0)" ""

echo "== 2. however the state was typed, the lead lands in the right one"
l1=$(awebp /leads '{"name":"TN Spaced","phone":"9000000201","state":"Tamil Nadu","source":"phone"}')
l2=$(awebp /leads '{"name":"TN Jammed","phone":"9000000202","state":"tamilnadu","source":"phone"}')
l3=$(awebp /leads '{"name":"TN Code","phone":"9000000203","state":"TN","source":"phone"}')
l4=$(awebp /leads '{"name":"KL Misspelt","phone":"9000000204","state":"Kerela","source":"phone"}')
l5=$(awebp /leads '{"name":"KA Lead","phone":"9000000205","state":"Karnataka","source":"phone"}')
l6=$(awebp /leads '{"name":"Nowhere Lead","phone":"9000000206","state":"Atlantis","source":"phone"}')
L1=$(id_of "$l1"); L2=$(id_of "$l2"); L3=$(id_of "$l3")
L4=$(id_of "$l4"); L5=$(id_of "$l5"); L6=$(id_of "$l6")

tnlist=$(awebg "/leads?state=$TN")
check "all three spellings of Tamil Nadu filter together" \
  "$([ "$(has "$tnlist" 'TN Spaced')" = "1" ] && [ "$(has "$tnlist" 'TN Jammed')" = "1" ] && [ "$(has "$tnlist" 'TN Code')" = "1" ] && echo 1 || echo 0)" "$tnlist"
check "and nothing from another state comes with them" "$(hasnt "$tnlist" 'KA Lead')" ""
check "the resolved name is on the row" "$(has "$tnlist" '"state_name":"Tamil Nadu"')" ""
kllist=$(awebg "/leads?state=$KL")
check "a misspelt Kerala still lands in Kerala" "$(has "$kllist" 'KL Misspelt')" "$kllist"
nonelist=$(awebg "/leads?state=none")
check "a state nobody recognises is listed under none" "$(has "$nonelist" 'Nowhere Lead')" ""
check "and is not in any state's list" "$(hasnt "$tnlist" 'Nowhere Lead')" ""

echo "== 3. giving a sales person their states"
ravi=$(awebp /users "{\"name\":\"Ravi South\",\"phone\":\"9000000301\",\"role\":\"sales\",\"password\":\"$PW\",\"must_change_password\":false,\"state_ids\":[$TN,$KL]}")
RAVI=$(id_of "$ravi")
check "created with two states" "$(has "$ravi" 'Covering 2 states')" "$ravi"
check "the states come back on the user" \
  "$([ "$(has "$ravi" '"name":"Tamil Nadu"')" = "1" ] && [ "$(has "$ravi" '"name":"Kerala"')" = "1" ] && echo 1 || echo 0)" "$ravi"

guna=$(awebp /users "{\"name\":\"Guna North\",\"phone\":\"9000000302\",\"role\":\"sales\",\"password\":\"$PW\",\"must_change_password\":false,\"state_ids\":[$KA]}")
GUNA=$(id_of "$guna")
check "a second person covers Karnataka" "$(has "$guna" '"name":"Karnataka"')" "$guna"

check "the list of users shows who covers what" "$(has "$(awebg /users)" '"code":"TN"')" ""
check "the state list counts the people in it" "$(has "$(awebg /states)" 'user_count')" ""

echo "== 4. the rep's app lists the leads in their states"
RT=$(applogin 9000000301)
GT=$(applogin 9000000302)
check "both signed in" "$([ -n "$RT" ] && [ -n "$GT" ] && echo 1 || echo 0)" ""

boot=$(appg "$RT" /bootstrap)
check "bootstrap carries the states they cover" \
  "$([ "$(has "$boot" '"my_states"')" = "1" ] && [ "$(has "$boot" '"name":"Tamil Nadu"')" = "1" ] && echo 1 || echo 0)" ""
check "and the whole list, for the lead form" "$(has "$boot" '"states"')" ""

rlist=$(appg "$RT" /leads)
check "Ravi sees the Tamil Nadu leads" \
  "$([ "$(has "$rlist" 'TN Spaced')" = "1" ] && [ "$(has "$rlist" 'TN Jammed')" = "1" ] && [ "$(has "$rlist" 'TN Code')" = "1" ] && echo 1 || echo 0)" ""
check "and the Kerala one" "$(has "$rlist" 'KL Misspelt')" ""
check "but not Karnataka" "$(hasnt "$rlist" 'KA Lead')" ""
check "nor the one in no state at all" "$(hasnt "$rlist" 'Nowhere Lead')" ""

glist=$(appg "$GT" /leads)
check "Guna sees only Karnataka" \
  "$([ "$(has "$glist" 'KA Lead')" = "1" ] && [ "$(hasnt "$glist" 'TN Spaced')" = "1" ] && echo 1 || echo 0)" ""

echo "== 5. one of their own states, on its own"
filtered=$(appg "$RT" "/leads?state=$KL")
check "filtering to Kerala leaves just that one" \
  "$([ "$(has "$filtered" 'KL Misspelt')" = "1" ] && [ "$(hasnt "$filtered" 'TN Spaced')" = "1" ] && echo 1 || echo 0)" ""
cheeky=$(appg "$RT" "/leads?state=$KA")
check "filtering to a state they do not cover shows nothing" "$(hasnt "$cheeky" 'KA Lead')" "$cheeky"

echo "== 6. an assigned lead belongs to the person it was given to"
asg=$(awebp "/leads/$L1/assign" "{\"owner_user_id\":$GUNA}")
check "the office assigns it to the Karnataka rep" "$(has "$asg" 'assigned to Guna North')" "$asg"
rlist2=$(appg "$RT" /leads)
check "it leaves the territory list of the other rep" "$(hasnt "$rlist2" 'TN Spaced')" ""
glist2=$(appg "$GT" /leads)
check "and follows the person, even outside their states" "$(has "$glist2" 'TN Spaced')" ""
direct=$(appg "$RT" "/leads/$L1")
check "the first rep cannot open it by id either" "$(has "$direct" 'Lead not found')" "$direct"

echo "== 7. a new enquiry from the website appears in the right app"
site=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Website Enquiry TN","phone":"9000000207","state":"Tamil Nadu","interest":"welding machine","message":"from the website"}' \
  "$BACK/api/enquiry")
check "the website accepted it" "$(has "$site" '"ok":true')" "$site"
SITE=$(echo "$site" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
check "and it is in the Tamil Nadu rep's app, unassigned" "$(has "$(appg "$RT" /leads)" 'Website Enquiry TN')" ""

echo "== 8. moving a rep's territory moves their list"
awebp "/users/$RAVI" "{\"name\":\"Ravi South\",\"phone\":\"9000000301\",\"role\":\"sales\",\"active\":true,\"state_ids\":[$KL]}" PUT > /dev/null
rlist3=$(appg "$RT" /leads)
check "dropping Tamil Nadu drops its leads" "$(hasnt "$rlist3" 'Website Enquiry TN')" ""
check "Kerala stays" "$(has "$rlist3" 'KL Misspelt')" ""
awebp "/users/$RAVI" "{\"name\":\"Ravi South\",\"phone\":\"9000000301\",\"role\":\"sales\",\"active\":true,\"state_ids\":[]}" PUT > /dev/null
empty=$(appg "$RT" /leads)
check "with no states left, only what is assigned to them" "$(hasnt "$empty" 'KL Misspelt')" "$empty"

echo "== 9. saving a user without the field leaves their states alone"
awebp "/users/$GUNA" "{\"name\":\"Guna North\",\"phone\":\"9000000302\",\"role\":\"sales\",\"active\":true}" PUT > /dev/null
still=$(awebg "/users/$GUNA")
check "Karnataka is still there" "$(has "$still" '"code":"KA"')" "$still"

echo "== 10. nonsense is refused or ignored, never saved"
bad=$(awebp "/users/$GUNA" "{\"name\":\"Guna North\",\"phone\":\"9000000302\",\"role\":\"sales\",\"active\":true,\"state_ids\":[99999,\"x\",-3]}" PUT)
check "ids that do not exist are dropped" "$(hasnt "$bad" '99999')" "$bad"
check "and the person is left covering nothing rather than failing" "$(has "$bad" '"states":[]')" "$bad"

echo "== 11. clearing up"
awebd "/users/$RAVI" > /dev/null; awebd "/users/$GUNA" > /dev/null
# Swept by the phone numbers this file uses rather than by remembered ids, so a
# run that stopped half way cannot leave rows behind for the next one.
for id in $(awebg "/leads?q=90000020" | grep -o '"id":[0-9]*' | cut -d: -f2); do
  awebd "/leads/$id" > /dev/null
done
for id in $(awebg "/leads?q=90000002" | grep -o '"id":[0-9]*' | cut -d: -f2); do
  awebd "/leads/$id" > /dev/null
done
left=$(awebg "/leads?q=90000002")
check "test leads gone" "$(hasnt "$left" '900000020')" "$left"
searchable=$(awebg "/leads?q=a&state=none")
check "search and the state filter still answer together" "$(has "$searchable" '"meta"')" "$searchable"
rm -f "$JAR"

echo
if [ "$fails" -eq 0 ]; then echo "all checks passed"; else echo "$fails FAILURE(S)"; fi
exit $((fails > 0))
