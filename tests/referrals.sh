#!/usr/bin/env bash
# Referral leads: the referrer is captured, reused, and priced.
#
#   bash tests/referrals.sh
#
# Needs the local servers running. Creates its own leads and referrers, all
# marked, and removes only those at the end.
set -uo pipefail

BASE="${VISBOT_BASE:-http://127.0.0.1:9002}"
API="$BASE/api/admin"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# A value out of a .env file. dotenv strips surrounding quotes, so this has to
# as well: a password containing a '#' must be quoted in the file, and without
# this the quotes arrive as part of the password.
envval() { grep -E "^$2=" "$1" | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"; }

DB=$(envval "$DIR/server/.env" DATABASE_URL)
USER=$(envval "$DIR/server/.env" ADMIN_USER)
PASS=$(envval "$DIR/server/.env" ADMIN_PASSWORD)
: "${USER:=admin}"; : "${PASS:=visbot@123}"

JAR=$(mktemp); MARK="ZZREF$$"
# A mobile nobody real has, so the dedupe tests cannot collide with live rows.
NUM1="+91 90000 1$(printf '%04d' $((RANDOM % 10000)))"
TAIL1=$(printf '%s' "$NUM1" | tr -cd '0-9' | tail -c 10)

pass=0; fails=()
ok()  { pass=$((pass+1)); printf "  PASS  %s\n" "$1"; }
bad() { fails+=("$1"); printf "  FAIL  %s\n     %s\n" "$1" "${2:-}"; }
say() { printf "\n== %s\n" "$1"; }
q()   { psql "$DB" -At -c "$1"; }

cleanup() {
  say "clearing up"
  q "delete from leads where name like '$MARK%'" >/dev/null
  q "delete from referrers where name like '$MARK%'" >/dev/null
  rm -f "$JAR"
  printf "  test leads and referrers removed\n"
}
trap cleanup EXIT

# POST/PUT a JSON body, printing the HTTP code and the body on one line.
# The panel sends X-Requested-With on every state change; the API refuses
# anything that does not, which is what closes the CSRF gap.
XRW='X-Requested-With: visbot-admin'
call() {  # method, path, json
  curl -s -o /tmp/ref-body.$$ -w "%{http_code}" --max-time 10 -b "$JAR" \
    -X "$1" "$API/$2" -H "Content-Type: application/json" -H "$XRW" --data-binary "$3"
}
body() { cat /tmp/ref-body.$$; }
# One field out of the last response body.
field() { python3 -I -c "
import json,sys
try: d=json.load(open('/tmp/ref-body.$$'))
except Exception: print('ERR-PARSE'); raise SystemExit
print($1)" 2>/dev/null; }

get() {  # path, python expression over d
  curl -s --max-time 10 -b "$JAR" "$API/$1" | python3 -I -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('ERR-PARSE'); raise SystemExit
if 'error' in d: print('ERR:'+str(d['error'])[:70]); raise SystemExit
print($2)"
}

say "signing in"
LOGIN=$(printf '{"identifier":"%s","password":"%s"}' "$USER" "$PASS")
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -c "$JAR" -X POST "$API/login" \
  -H "Content-Type: application/json" -H "$XRW" --data-binary "$LOGIN")
[ "$code" = "200" ] && ok "signed in" || { bad "signed in" "HTTP $code"; exit 1; }

# ---------------------------------------------------------------------------
say "a referral lead captures who referred it"
code=$(call POST leads "$(printf '{"name":"%s first","source":"referral","referrer_name":"%s Ramesh","referrer_phone":"%s","referral_kind":"percent","referral_value":"5"}' "$MARK" "$MARK" "$NUM1")")
[ "$code" = "200" ] && ok "the lead saved" || bad "the lead saved" "HTTP $code $(body)"
LEAD1=$(field 'd["data"]["id"]')

n=$(q "select count(*) from referrers where name = '$MARK Ramesh'")
[ "$n" = "1" ] && ok "a referrer row was created" || bad "a referrer row was created" "got $n"

got=$(get "leads/$LEAD1" 'd["data"]["lead"]["referrer_name"]')
[ "$got" = "$MARK Ramesh" ] && ok "the lead reads back the referrer's name" || bad "the lead reads back the referrer's name" "got '$got'"
got=$(get "leads/$LEAD1" 'str(d["data"]["lead"]["referral_kind"]) + " " + str(d["data"]["lead"]["referral_value"])')
case "$got" in
  "percent 5"*) ok "and the fee, as a percentage ($got)" ;;
  *)            bad "and the fee, as a percentage" "got '$got'" ;;
esac

say "the same mobile is the same person, however it is typed"
# 0 prefix, no country code, no spaces: all the same ten digits.
code=$(call POST leads "$(printf '{"name":"%s second","source":"referral","referrer_name":"%s Ramesh Kumar","referrer_phone":"0%s","referral_kind":"flat","referral_value":"2500"}' "$MARK" "$MARK" "$TAIL1")")
[ "$code" = "200" ] && ok "a second lead from the same number saved" || bad "second lead saved" "HTTP $code $(body)"
LEAD2=$(field 'd["data"]["id"]')

n=$(q "select count(*) from referrers where phone is not null and right(regexp_replace(phone,'\D','','g'),10) = '$TAIL1'")
[ "$n" = "1" ] && ok "still one referrer, not two" || bad "still one referrer, not two" "got $n"

a=$(get "leads/$LEAD1" 'd["data"]["lead"]["referrer_id"]')
b=$(get "leads/$LEAD2" 'd["data"]["lead"]["referrer_id"]')
[ "$a" = "$b" ] && ok "both leads point at the one referrer" || bad "both leads point at the one referrer" "$a vs $b"

got=$(get "leads/$LEAD2" 'd["data"]["lead"]["referrer_name"]')
[ "$got" = "$MARK Ramesh" ] && ok "the name first entered is kept, not overwritten" || bad "the name first entered is kept" "got '$got'"

say "a referrer without a mobile is matched on the name"
code=$(call POST leads "$(printf '{"name":"%s third","source":"referral","referrer_name":"%s Nameonly"}' "$MARK" "$MARK")")
[ "$code" = "200" ] && ok "a referral with no mobile saved" || bad "a referral with no mobile saved" "HTTP $code $(body)"
code=$(call POST leads "$(printf '{"name":"%s fourth","source":"referral","referrer_name":"  %s nameonly  "}' "$MARK" "$MARK")")
[ "$code" = "200" ] && ok "and again, differently spaced and cased" || bad "and again" "HTTP $code $(body)"
n=$(q "select count(*) from referrers where lower(btrim(name)) = lower('$MARK Nameonly')")
[ "$n" = "1" ] && ok "one referrer, not two" || bad "one referrer, not two" "got $n"

# ---------------------------------------------------------------------------
say "a fee that cannot be stored honestly is refused"
code=$(call POST leads "$(printf '{"name":"%s bad1","source":"referral","referrer_name":"%s X","referral_kind":"percent","referral_value":"101"}' "$MARK" "$MARK")")
[ "$code" = "400" ] && ok "over 100% is refused" || bad "over 100% is refused" "HTTP $code $(body)"
code=$(call POST leads "$(printf '{"name":"%s bad2","source":"referral","referrer_name":"%s X","referral_value":"5"}' "$MARK" "$MARK")")
[ "$code" = "400" ] && ok "an amount with no kind is refused" || bad "an amount with no kind is refused" "HTTP $code $(body)"
code=$(call POST leads "$(printf '{"name":"%s bad3","source":"referral","referrer_name":"%s X","referral_kind":"flat","referral_value":"-5"}' "$MARK" "$MARK")")
[ "$code" = "400" ] && ok "a negative fee is refused" || bad "a negative fee is refused" "HTTP $code $(body)"
code=$(call POST leads "$(printf '{"name":"%s bad4","source":"referral","referrer_name":"%s X","referral_kind":"flat","referral_value":"12abc"}' "$MARK" "$MARK")")
[ "$code" = "400" ] && ok "a fee that is not a number is refused" || bad "not a number is refused" "HTTP $code $(body)"
code=$(call POST leads "$(printf '{"name":"%s bad5","source":"referral"}' "$MARK")")
[ "$code" = "400" ] && ok "a referral with no referrer name is refused" || bad "no referrer name is refused" "HTTP $code $(body)"

say "a refused lead leaves nothing behind"
n=$(q "select count(*) from leads where name like '$MARK bad%'")
[ "$n" = "0" ] && ok "no lead was created" || bad "no lead was created" "got $n"
n=$(q "select count(*) from referrers where name = '$MARK X'")
[ "$n" = "0" ] && ok "and no stray referrer either" || bad "no stray referrer" "got $n"

say "a lead with no name cannot create a referrer"
code=$(call POST leads "$(printf '{"name":"","source":"referral","referrer_name":"%s Ghost"}' "$MARK")")
[ "$code" = "400" ] && ok "the nameless lead is refused" || bad "the nameless lead is refused" "HTTP $code $(body)"
n=$(q "select count(*) from referrers where name = '$MARK Ghost'")
[ "$n" = "0" ] && ok "and left no referrer behind" || bad "left no referrer behind" "got $n"

# ---------------------------------------------------------------------------
say "moving a lead off Referral clears what it owed"
code=$(call PUT "leads/$LEAD1" "$(printf '{"name":"%s first","source":"phone"}' "$MARK")")
[ "$code" = "200" ] && ok "the lead saved as a phone call" || bad "saved as a phone call" "HTTP $code $(body)"
got=$(q "select coalesce(referrer_id::text,'null') || ' ' || coalesce(referral_kind,'null') || ' ' || coalesce(referral_value::text,'null') from leads where id = $LEAD1")
[ "$got" = "null null null" ] && ok "referrer and fee are both cleared" || bad "referrer and fee are both cleared" "got '$got'"
n=$(q "select count(*) from referrers where name = '$MARK Ramesh'")
[ "$n" = "1" ] && ok "the referrer themselves is kept" || bad "the referrer is kept" "got $n"

# ---------------------------------------------------------------------------
say "the referrers list counts what each person brought in"
RID=$(q "select id from referrers where name = '$MARK Ramesh'")
got=$(get "referrers/$RID" 'str(d["data"]["referrer"]["lead_count"])')
[ "$got" = "1" ] && ok "one lead left against them after the move" || bad "lead_count after the move" "got $got"

# Win it, and the flat fee becomes money owed.
q "update leads set status='won' where id = $LEAD2" >/dev/null
got=$(get "referrers/$RID" 'str(d["data"]["referrer"]["won_count"]) + " " + str(d["data"]["referrer"]["flat_won_total"])')
[ "$got" = "1 2500" ] && ok "a won flat referral totals as money owed ($got)" || bad "flat_won_total" "got '$got'"

got=$(get "referrers/$RID" 'len(d["data"]["leads"])')
[ "$got" = "1" ] && ok "their leads are listed with them" || bad "their leads are listed" "got $got"

say "the list pages and reports totals, like every other list"
got=$(get "referrers" '(d.get("meta") or {}).get("per_page")')
[ "$got" = "25" ] && ok "a meta block with the usual page size" || bad "a meta block" "got $got"
got=$(get "referrers?per_page=10" '(d.get("meta") or {}).get("per_page")')
[ "$got" = "10" ] && ok "and it honours per_page" || bad "honours per_page" "got $got"
got=$(get "referrers" '"totals" in d')
[ "$got" = "True" ] && ok "and carries the headline totals" || bad "carries totals" "got $got"

say "searching the list"
got=$(get "referrers?q=$MARK" 'len(d["data"]) >= 2')
[ "$got" = "True" ] && ok "a search finds the test referrers" || bad "a search finds them" "got $got"
got=$(get "referrers?q=nobodymatchesthisatall" 'len(d["data"])')
[ "$got" = "0" ] && ok "and finds nothing for nonsense" || bad "finds nothing for nonsense" "got $got"

# ---------------------------------------------------------------------------
say "a referrer with leads cannot simply be removed"
code=$(curl -s -o /tmp/ref-body.$$ -w "%{http_code}" --max-time 10 -b "$JAR" -H "$XRW" -X DELETE "$API/referrers/$RID")
[ "$code" = "409" ] && ok "removing them is refused while leads name them" || bad "removal refused" "HTTP $code $(body)"
n=$(q "select count(*) from referrers where id = $RID")
[ "$n" = "1" ] && ok "and they are still there" || bad "still there" "got $n"

got=$(field 'd["error"]["message"]')
case "$got" in
  *"Switch them off"*) ok "the refusal says what to do instead" ;;
  *)                   bad "the refusal says what to do instead" "got '$got'" ;;
esac

say "two referrers cannot share one mobile"
code=$(call POST referrers "$(printf '{"name":"%s Impostor","phone":"%s"}' "$MARK" "$NUM1")")
[ "$code" = "409" ] && ok "a duplicate mobile is refused" || bad "duplicate mobile refused" "HTTP $code $(body)"
n=$(q "select count(*) from referrers where name = '$MARK Impostor'")
[ "$n" = "0" ] && ok "and nothing was created" || bad "nothing was created" "got $n"

say "switching a referrer off keeps their history"
code=$(call PUT "referrers/$RID" "$(printf '{"name":"%s Ramesh","phone":"%s","active":""}' "$MARK" "$NUM1")")
[ "$code" = "200" ] && ok "they can be switched off" || bad "switched off" "HTTP $code $(body)"
got=$(q "select active from referrers where id = $RID")
[ "$got" = "f" ] && ok "and are marked inactive" || bad "marked inactive" "got '$got'"
got=$(get "referrers/$RID" 'str(d["data"]["referrer"]["lead_count"])')
[ "$got" = "1" ] && ok "their leads are untouched" || bad "leads untouched" "got $got"
got=$(get "referrers?active=0" "any(r['id'] == $RID for r in d['data'])")
[ "$got" = "True" ] && ok "and the off-only filter finds them" || bad "off-only filter" "got $got"

say "the database refuses a bad fee even from psql"
got=$(psql "$DB" -At -c "update leads set referral_kind='percent', referral_value=150 where id = $LEAD2" 2>&1 | head -1)
case "$got" in
  *violates*check*) ok "a 150% fee is rejected by the check constraint" ;;
  *)                bad "a 150% fee is rejected by the check constraint" "got '$got'" ;;
esac
got=$(psql "$DB" -At -c "update leads set referral_kind='bribe' where id = $LEAD2" 2>&1 | head -1)
case "$got" in
  *violates*check*) ok "and so is a fee kind the panel cannot read" ;;
  *)                bad "a bad fee kind is rejected" "got '$got'" ;;
esac

say "the lead form can offer the referrers already on file"
got=$(get "referrers/suggest" "any(r['name'] == '$MARK Nameonly' for r in d['data'])")
[ "$got" = "True" ] && ok "a referrer is offered for picking" || bad "a referrer is offered" "got $got"
got=$(get "referrers/suggest" "sorted((d['data'][0] or {}).keys())")
[ "$got" = "['id', 'name', 'phone']" ] && ok "with just the three columns the form needs" || bad "three columns only" "got $got"
# A referrer switched off earlier in this run must not be offered on new leads.
got=$(get "referrers/suggest" "any(r['id'] == $RID for r in d['data'])")
[ "$got" = "False" ] && ok "a switched-off referrer is not offered" || bad "switched-off referrer is not offered" "got $got"
got=$(get "referrers/$RID" 'str(d["data"]["referrer"]["lead_count"])')
[ "$got" = "1" ] && ok "though their own page still has their history" || bad "history kept" "got $got"

say "a name nobody has used creates the referrer on save"
before=$(q "select count(*) from referrers")
code=$(call POST leads "$(printf '{"name":"%s fifth","source":"referral","referrer_name":"%s Brand New","referrer_phone":"+91 90000 29999","referral_kind":"flat","referral_value":"1000"}' "$MARK" "$MARK")")
[ "$code" = "200" ] && ok "the lead saved" || bad "the lead saved" "HTTP $code $(body)"
after=$(q "select count(*) from referrers")
[ "$after" = "$((before + 1))" ] && ok "and one new referrer appeared" || bad "one new referrer appeared" "$before -> $after"
got=$(get "referrers/suggest" "any(r['name'] == '$MARK Brand New' for r in d['data'])")
[ "$got" = "True" ] && ok "who is offered on the next lead straight away" || bad "offered next time" "got $got"
# The mobile travels with them: it is what the form fills in once a name is picked.
got=$(get "referrers/suggest" "next((r['phone'] for r in d['data'] if r['name'] == '$MARK Brand New'), 'MISSING')")
case "$got" in
  *"90000 29999"*) ok "with the mobile that gets filled in ($got)" ;;
  *)               bad "the mobile is offered" "got '$got'" ;;
esac

printf "\n"
rm -f /tmp/ref-body.$$
if [ ${#fails[@]} -gt 0 ]; then
  printf "%d passed, %d failed:\n" "$pass" "${#fails[@]}"
  for f in "${fails[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "all %d checks passed\n" "$pass"
