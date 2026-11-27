#!/usr/bin/env bash
# The leads date filter and the dashboard chart series, against the local
# servers and database.
#
#   bash tests/date-filter.sh
#
# It signs in as the .env administrator, creates leads dated today, yesterday
# and 40 days ago, checks what each filter returns, then deletes only those.
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

JAR=$(mktemp); MARK="ZZDATE$$"
pass=0; fails=()
ok()  { pass=$((pass+1)); printf "  PASS  %s\n" "$1"; }
bad() { fails+=("$1"); printf "  FAIL  %s\n     %s\n" "$1" "${2:-}"; }
say() { printf "\n== %s\n" "$1"; }
q()   { psql "$DB" -At -c "$1"; }

cleanup() {
  say "clearing up"
  local ids
  ids=$(q "select id from leads where name like '$MARK%'")
  if [ -n "$ids" ]; then
    q "delete from lead_notes where lead_id in ($(echo "$ids" | paste -sd, -))" >/dev/null
    q "delete from leads where id in ($(echo "$ids" | paste -sd, -))" >/dev/null
  fi
  rm -f "$JAR"
  printf "  test leads removed\n"
}
trap cleanup EXIT

# Count how many of OUR leads a filter returns, by name prefix.
mine() {  # query-string
  curl -s --max-time 10 -b "$JAR" "$API/leads?q=$MARK&$1" \
    | python3 -I -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('ERR'); raise SystemExit
if 'error' in d: print('ERR:'+str(d['error'])[:60]); raise SystemExit
print(len([r for r in d.get('data',[]) if r['name'].startswith('$MARK')]))"
}

say "signing in"
LOGIN=$(printf '{"identifier":"%s","password":"%s"}' "$USER" "$PASS")
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -c "$JAR" -X POST "$API/login" \
  -H "Content-Type: application/json" --data-binary "$LOGIN")
[ "$code" = "200" ] && ok "signed in as the administrator" \
  || { bad "signed in as the administrator" "HTTP $code"; printf "\ncannot continue\n"; exit 1; }

say "leads dated today, yesterday, and 40 days ago"
# Written straight to the database so the timestamps are exact. Indian time is
# what the filter uses, so the rows are built that way too.
q "insert into leads (name, phone, source, status, created_at) values
   ('${MARK}_today','9000000001','phone','new',  (now() AT TIME ZONE 'Asia/Kolkata')::date + time '10:30' AT TIME ZONE 'Asia/Kolkata'),
   ('${MARK}_early','9000000002','phone','new',  (now() AT TIME ZONE 'Asia/Kolkata')::date + time '01:15' AT TIME ZONE 'Asia/Kolkata'),
   ('${MARK}_yest','9000000003','phone','new',   ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1) + time '14:00' AT TIME ZONE 'Asia/Kolkata'),
   ('${MARK}_old','9000000004','phone','new',    ((now() AT TIME ZONE 'Asia/Kolkata')::date - 40) + time '12:00' AT TIME ZONE 'Asia/Kolkata')" >/dev/null
ok "four leads created"

say "the filters"
n=$(mine "period=today");     [ "$n" = "2" ] && ok "Today finds both of today's"            || bad "Today finds both of today's" "got $n, wanted 2"
n=$(mine "period=yesterday"); [ "$n" = "1" ] && ok "Yesterday finds only yesterday's"       || bad "Yesterday finds only yesterday's" "got $n, wanted 1"
n=$(mine "period=7d");        [ "$n" = "3" ] && ok "Last 7 days finds three"                || bad "Last 7 days finds three" "got $n, wanted 3"
n=$(mine "period=30d");       [ "$n" = "3" ] && ok "Last 30 days excludes the 40-day-old"   || bad "Last 30 days excludes the 40-day-old" "got $n, wanted 3"
n=$(mine "");                 [ "$n" = "4" ] && ok "no filter finds all four"               || bad "no filter finds all four" "got $n, wanted 4"

say "a lead at 1.15am is still today"
# The point of the timezone work: 01:15 in Coimbatore is 19:45 UTC the day
# before, so a naive filter would file it under yesterday.
got=$(curl -s --max-time 10 -b "$JAR" "$API/leads?q=${MARK}_early&period=today" \
  | python3 -I -c "import json,sys; print(len(json.load(sys.stdin).get('data',[])))")
[ "$got" = "1" ] && ok "an early-morning lead counts as today, not yesterday" \
  || bad "an early-morning lead counts as today, not yesterday" "got $got"

say "between two dates"
TODAY=$(q "select (now() AT TIME ZONE 'Asia/Kolkata')::date")
YEST=$(q "select ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text")
n=$(mine "from=$YEST&to=$YEST");   [ "$n" = "1" ] && ok "a single-day range"        || bad "a single-day range" "got $n, wanted 1"
n=$(mine "from=$YEST&to=$TODAY");  [ "$n" = "3" ] && ok "a two-day range"           || bad "a two-day range" "got $n, wanted 3"
n=$(mine "from=$TODAY");           [ "$n" = "2" ] && ok "an open-ended from"        || bad "an open-ended from" "got $n, wanted 2"
n=$(mine "to=$YEST");              [ "$n" = "2" ] && ok "an open-ended to"          || bad "an open-ended to" "got $n, wanted 2"

say "rubbish is ignored, never passed to the database"
n=$(mine "period=%3B%20drop%20table%20leads"); [ "$n" = "4" ] && ok "an unknown period is ignored"  || bad "an unknown period is ignored" "got $n"
n=$(mine "from=notadate");             [ "$n" = "4" ] && ok "a malformed date is ignored"   || bad "a malformed date is ignored" "got $n"
n=$(q "select count(*) from leads where name like '$MARK%'"); [ "$n" = "4" ] && ok "and the table is still there" || bad "and the table is still there" "$n"

say "the filter combines with the others"
n=$(mine "period=today&source=phone");    [ "$n" = "2" ] && ok "with a source"    || bad "with a source" "got $n, wanted 2"
n=$(mine "period=today&source=website");  [ "$n" = "0" ] && ok "and excludes"     || bad "and excludes" "got $n, wanted 0"
n=$(mine "period=today&status=won");      [ "$n" = "0" ] && ok "with a status"    || bad "with a status" "got $n, wanted 0"

say "the dashboard chart data"
DASH=$(curl -s --max-time 10 -b "$JAR" "$API/dashboard")
echo "$DASH" | python3 -I -c "
import json,sys
d=json.load(sys.stdin)['data']
daily=d.get('daily',[]); monthly=d.get('monthly',[])
assert len(daily)==14, 'daily has %d rows, wanted 14' % len(daily)
assert len(monthly)==6, 'monthly has %d rows, wanted 6' % len(monthly)
assert daily[-1]['n'] >= 2, 'today should hold at least our two leads, got %s' % daily[-1]['n']
assert 'today_count' in d['stats'], 'no today_count'
assert d['stats']['today_count'] >= 2, 'today_count too low'
print('   daily rows:', len(daily), '| monthly rows:', len(monthly), '| today:', d['stats']['today_count'])
" && ok "14 days, 6 months, and today's count all present" \
  || bad "14 days, 6 months, and today's count all present" "see above"

printf "\n"
if [ ${#fails[@]} -gt 0 ]; then
  printf "%d passed, %d failed:\n" "$pass" "${#fails[@]}"
  for f in "${fails[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "all %d checks passed\n" "$pass"
