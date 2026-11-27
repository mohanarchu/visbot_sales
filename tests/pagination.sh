#!/usr/bin/env bash
# Every list in the admin panel pages, and ?all=1 still returns everything.
#
#   bash tests/pagination.sh
#
# Needs the local servers running. It creates 30 regional contacts (the
# smallest list to fill), checks paging against them, and deletes only those.
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

JAR=$(mktemp); MARK="ZZPAGE$$"
pass=0; fails=()
ok()  { pass=$((pass+1)); printf "  PASS  %s\n" "$1"; }
bad() { fails+=("$1"); printf "  FAIL  %s\n     %s\n" "$1" "${2:-}"; }
say() { printf "\n== %s\n" "$1"; }
q()   { psql "$DB" -At -c "$1"; }

cleanup() {
  say "clearing up"
  q "delete from regional_contacts where region like '$MARK%'" >/dev/null
  rm -f "$JAR"
  printf "  test rows removed\n"
}
trap cleanup EXIT

# Reads one field out of a list response.
field() {  # path, python-expression over d
  curl -s --max-time 10 -b "$JAR" "$API/$1" | python3 -I -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('ERR-PARSE'); raise SystemExit
if 'error' in d: print('ERR:'+str(d['error'])[:70]); raise SystemExit
print($2)"
}

rows_len='len(d["data"]) if isinstance(d.get("data"), list) else len(d["data"].get("spares", []))'
meta_pages='(d.get("meta") or {}).get("pages")'
meta_total='(d.get("meta") or {}).get("total")'

say "signing in"
LOGIN=$(printf '{"identifier":"%s","password":"%s"}' "$USER" "$PASS")
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -c "$JAR" -X POST "$API/login" \
  -H "Content-Type: application/json" --data-binary "$LOGIN")
[ "$code" = "200" ] && ok "signed in" || { bad "signed in" "HTTP $code"; exit 1; }

say "every list reports paging"
for p in leads service service/visits service/reviews service/types users \
         categories products spares locations regions; do
  got=$(field "$p" "$meta_pages")
  case "$got" in
    ERR*|None|"") bad "$p reports a meta block" "got '$got'" ;;
    *)            ok  "$p reports a meta block (pages=$got)" ;;
  esac
done

say "30 regional contacts, to page through"
for i in $(seq -w 1 30); do
  q "insert into regional_contacts (region, phone, sort_order) values ('${MARK}_$i','+91 90000 000$i', $((10#$i)))" >/dev/null
done
TOTAL=$(q "select count(*) from regional_contacts")
ok "regions now number $TOTAL"

say "paging through them"
n=$(field "regions" "$rows_len");          [ "$n" = "25" ] && ok "page 1 holds 25"        || bad "page 1 holds 25" "got $n"
t=$(field "regions" "$meta_total");        [ "$t" = "$TOTAL" ] && ok "the total is the whole list" || bad "the total is the whole list" "got $t, wanted $TOTAL"
n=$(field "regions?page=2" "$rows_len")
want=$((TOTAL - 25)); [ "$n" = "$want" ] && ok "page 2 holds the rest ($want)" || bad "page 2 holds the rest" "got $n, wanted $want"

say "the pages do not overlap"
A=$(curl -s -b "$JAR" "$API/regions" | python3 -I -c "import json,sys; print(' '.join(str(r['id']) for r in json.load(sys.stdin)['data']))")
B=$(curl -s -b "$JAR" "$API/regions?page=2" | python3 -I -c "import json,sys; print(' '.join(str(r['id']) for r in json.load(sys.stdin)['data']))")
DUP=$(python3 -I -c "
a=set('''$A'''.split()); b=set('''$B'''.split())
print(len(a & b))")
[ "$DUP" = "0" ] && ok "no row appears on both pages" || bad "no row appears on both pages" "$DUP shared"

say "out-of-range pages are clamped, not errors"
n=$(field "regions?page=999" "$rows_len")
[ "$n" != "ERR" ] && [ -n "$n" ] && ok "a page past the end still answers" || bad "a page past the end still answers" "got $n"
pg=$(field "regions?page=999" '(d.get("meta") or {}).get("page")')
last=$(field "regions" "$meta_pages")
[ "$pg" = "$last" ] && ok "and lands on the last page ($last)" || bad "and lands on the last page" "got $pg, wanted $last"
n=$(field "regions?page=0" "$rows_len");        [ "$n" = "25" ] && ok "page 0 behaves as page 1"      || bad "page 0 behaves as page 1" "got $n"
n=$(field "regions?page=-4" "$rows_len");       [ "$n" = "25" ] && ok "a negative page too"           || bad "a negative page too" "got $n"
n=$(field "regions?page=abc" "$rows_len");      [ "$n" = "25" ] && ok "and nonsense too"              || bad "and nonsense too" "got $n"

say "?all=1 still returns everything — the forms depend on it"
n=$(field "regions?all=1" "$rows_len")
[ "$n" = "$TOTAL" ] && ok "regions?all=1 returns all $TOTAL" || bad "regions?all=1 returns all" "got $n"
for p in categories spares service/types service/reviews; do
  a=$(field "$p?all=1" "$rows_len")
  b=$(field "$p?all=1" "$meta_total")
  [ "$a" = "$b" ] && ok "$p?all=1 returns all $a" || bad "$p?all=1 returns all" "rows $a, total $b"
done

say "paging keeps the filters"
n=$(field "regions?q=nothingmatchesthis" "$rows_len")
[ "$n" != "ERR" ] && ok "an unrelated query parameter is harmless" || bad "an unrelated query parameter is harmless" "got $n"
a=$(field "leads?period=today" "$meta_total")
b=$(field "leads?period=today&page=1" "$meta_total")
[ "$a" = "$b" ] && ok "a filtered total is the filtered count, not the table count" || bad "a filtered total" "$a vs $b"

say "the row count is selectable, and only from the offered sizes"
# 10 is the smallest size the panel offers; with 38 regions it must page.
n=$(field "regions?per_page=10" "$rows_len")
[ "$n" = "10" ] && ok "per_page=10 returns 10 rows" || bad "per_page=10 returns 10 rows" "got $n"
pp=$(field "regions?per_page=10" '(d.get("meta") or {}).get("per_page")')
[ "$pp" = "10" ] && ok "and says so in the meta block" || bad "and says so in the meta block" "got $pp"
pg=$(field "regions?per_page=10" "$meta_pages")
want=$(( (TOTAL + 9) / 10 ))
[ "$pg" = "$want" ] && ok "the page count follows the size ($want)" || bad "the page count follows the size" "got $pg, wanted $want"
n=$(field "regions?per_page=10&page=2" "$rows_len")
[ "$n" = "10" ] && ok "page 2 of ten-row pages holds 10"    || bad "page 2 of ten-row pages holds 10" "got $n"
n=$(field "regions?per_page=50" "$rows_len")
[ "$n" = "$TOTAL" ] && ok "per_page=50 holds all $TOTAL"     || bad "per_page=50 holds all" "got $n"

# A size outside the offered set is a way to ask the server to read a whole
# table into memory, so it must fall back rather than obey.
for bad_size in 1000000 999 0 -5 abc ""; do
  pp=$(field "regions?per_page=$bad_size" '(d.get("meta") or {}).get("per_page")')
  [ "$pp" = "25" ] && ok "per_page=${bad_size:-empty} falls back to 25" \
                   || bad "per_page=${bad_size:-empty} falls back to 25" "got $pp"
done

say "every list honours the row count"
for p in leads service service/visits service/reviews service/types users \
         categories products spares locations regions; do
  pp=$(field "$p?per_page=10" '(d.get("meta") or {}).get("per_page")')
  [ "$pp" = "10" ] && ok "$p honours per_page=10" || bad "$p honours per_page=10" "got $pp"
done

say "a row count never returns more rows than asked for"
for p in leads products regions; do
  n=$(field "$p?per_page=10" "$rows_len")
  if [ "$n" != "ERR" ] && [ -n "$n" ] && [ "$n" -le 10 ] 2>/dev/null; then
    ok "$p returns at most 10 rows (got $n)"
  else
    bad "$p returns at most 10 rows" "got $n"
  fi
done

say "?all=1 still wins over a row count — the forms depend on it"
n=$(field "regions?all=1&per_page=10" "$rows_len")
[ "$n" = "$TOTAL" ] && ok "all=1 beats per_page=10" || bad "all=1 beats per_page=10" "got $n"

printf "\n"
if [ ${#fails[@]} -gt 0 ]; then
  printf "%d passed, %d failed:\n" "$pass" "${#fails[@]}"
  for f in "${fails[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "all %d checks passed\n" "$pass"
