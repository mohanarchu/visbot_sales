#!/usr/bin/env bash
# The WhatsApp half of the Meta webhook, driven exactly as Meta drives it:
# signed with the App Secret, over the same /api/meta/webhook endpoint.
#
#   bash tests/whatsapp-webhook.sh
#
# It needs the local servers running (cd server && node bin/all.js) and it sets
# a throwaway App Secret and verify token in the LOCAL database, restoring
# whatever was there when it finishes. It deletes only the rows it created.
set -uo pipefail

BASE="${VISBOT_BASE:-http://127.0.0.1:9001}"
HOOK="$BASE/api/meta/webhook"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=$(grep -E '^DATABASE_URL=' "$DIR/server/.env" | cut -d= -f2-)

SECRET="test-app-secret-$$"
TOKEN="test-verify-$$"
# A phone number nobody real has, so a stray row is obvious.
WA_ID="919000000${RANDOM:0:3}"
TAIL="${WA_ID: -10}"

pass=0; fails=()
ok()   { pass=$((pass+1)); printf "  PASS  %s\n" "$1"; }
bad()  { fails+=("$1"); printf "  FAIL  %s\n     %s\n" "$1" "${2:-}"; }
q()    { psql "$DB" -At -c "$1"; }

say() { printf "\n== %s\n" "$1"; }

# ---------------------------------------------------------------- set-up ----
PREV_SECRET=$(q "select coalesce(value,'') from settings where key='meta_app_secret'")
PREV_TOKEN=$(q "select coalesce(value,'') from settings where key='meta_verify_token'")

restore() {
  say "clearing up"
  # Remove only what this run made.
  q "delete from whatsapp_messages where wamid like 'wamid.test.$$.%'" >/dev/null
  local ids
  ids=$(q "select id from leads where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)='$TAIL'")
  if [ -n "$ids" ]; then
    q "delete from lead_notes where lead_id in ($(echo "$ids" | paste -sd, -))" >/dev/null
    q "delete from leads where id in ($(echo "$ids" | paste -sd, -))" >/dev/null
  fi
  q "delete from integration_log where channel='meta' and event='whatsapp' and detail like '%lead(s)%' and created_at > now() - interval '5 minutes'" >/dev/null

  if [ -n "$PREV_SECRET" ]; then
    q "insert into settings (key,value) values ('meta_app_secret','$PREV_SECRET') on conflict (key) do update set value=excluded.value" >/dev/null
  else
    q "delete from settings where key='meta_app_secret'" >/dev/null
  fi
  if [ -n "$PREV_TOKEN" ]; then
    q "insert into settings (key,value) values ('meta_verify_token','$PREV_TOKEN') on conflict (key) do update set value=excluded.value" >/dev/null
  else
    q "delete from settings where key='meta_verify_token'" >/dev/null
  fi
  printf "  settings restored, test rows removed\n"
}
trap restore EXIT

q "insert into settings (key,value) values ('meta_app_secret','$SECRET') on conflict (key) do update set value=excluded.value" >/dev/null
q "insert into settings (key,value) values ('meta_verify_token','$TOKEN') on conflict (key) do update set value=excluded.value" >/dev/null

# Meta signs the exact bytes it sends.
send() {
  local body="$1"
  local sig
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$HOOK" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: sha256=$sig" \
    --data-binary "$body"
}

send_unsigned() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$HOOK" \
    -H "Content-Type: application/json" --data-binary "$1"
}

msg_payload() {  # wamid, text, extra json inside the message object
  cat <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{
  "messaging_product":"whatsapp",
  "metadata":{"display_phone_number":"918072398966","phone_number_id":"111"},
  "contacts":[{"wa_id":"$WA_ID","profile":{"name":"Ramesh Kumar"}}],
  "messages":[{"id":"$1","from":"$WA_ID","timestamp":"1764000000","type":"text","text":{"body":"$2"}$3}]
}}]}]}
JSON
}

# ---------------------------------------------------------------- checks ----
say "1. the handshake"
code=$(curl -s -o /tmp/vb_hs.$$ -w "%{http_code}" --max-time 10 \
  "$HOOK?hub.mode=subscribe&hub.verify_token=$TOKEN&hub.challenge=chal-42")
[ "$code" = "200" ] && [ "$(cat /tmp/vb_hs.$$)" = "chal-42" ] \
  && ok "the right token gets the challenge echoed" \
  || bad "the right token gets the challenge echoed" "HTTP $code, body $(cat /tmp/vb_hs.$$)"
rm -f /tmp/vb_hs.$$

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "$HOOK?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=chal-42")
[ "$code" = "403" ] && ok "a wrong token is refused" || bad "a wrong token is refused" "HTTP $code"

say "2. an unsigned delivery is refused"
code=$(send_unsigned "$(msg_payload "wamid.test.$$.unsigned" "should not land" "")")
[ "$code" = "403" ] && ok "no signature, no entry" || bad "no signature, no entry" "HTTP $code"
sleep 1
n=$(q "select count(*) from whatsapp_messages where wamid='wamid.test.$$.unsigned'")
[ "$n" = "0" ] && ok "and nothing was recorded" || bad "and nothing was recorded" "$n rows"

say "3. a message from a click-to-WhatsApp ad becomes a lead"
REF=',"referral":{"source_type":"ad","source_id":"120210000","headline":"uPVC Welding Machine offer","body":"Get a quote","source_url":"https://fb.me/x"}'
code=$(send "$(msg_payload "wamid.test.$$.a" "I want the welding machine price" "$REF")")
[ "$code" = "200" ] && ok "Meta gets its 200" || bad "Meta gets its 200" "HTTP $code"
sleep 2

row=$(q "select name, phone, source, status, interest from leads where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)='$TAIL'")
[ -n "$row" ] && ok "a lead exists" || bad "a lead exists" "no lead found"
echo "$row" | grep -q "Ramesh Kumar" && ok "with the WhatsApp profile name" || bad "with the WhatsApp profile name" "$row"
echo "$row" | grep -q "whatsapp|new" && ok "source whatsapp, status new" || bad "source whatsapp, status new" "$row"
echo "$row" | grep -q "uPVC Welding Machine offer" && ok "and the ad headline as the interest" || bad "and the ad headline as the interest" "$row"

LEAD_ID=$(q "select id from leads where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)='$TAIL' order by id limit 1")
notes=$(q "select kind || ': ' || note from lead_notes where lead_id=$LEAD_ID order by id")
echo "$notes" | grep -q "Started this chat from a WhatsApp ad" && ok "the ad is named in the activity log" || bad "the ad is named in the activity log" "$notes"
echo "$notes" | grep -q "I want the welding machine price" && ok "and so is what they said" || bad "and so is what they said" "$notes"
echo "$notes" | grep -q "assign it to a sales person" && ok "and it says to assign it" || bad "and it says to assign it" "$notes"

say "4. Meta's retry of the same message changes nothing"
code=$(send "$(msg_payload "wamid.test.$$.a" "I want the welding machine price" "$REF")")
sleep 2
n=$(q "select count(*) from leads where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)='$TAIL'")
[ "$n" = "1" ] && ok "still one lead" || bad "still one lead" "$n leads"
n=$(q "select count(*) from lead_notes where lead_id=$LEAD_ID")
[ "$n" = "2" ] && ok "and no duplicate note" || bad "and no duplicate note" "$n notes"

say "5. a second message joins the same lead"
code=$(send "$(msg_payload "wamid.test.$$.b" "What is the delivery time" "")")
sleep 2
n=$(q "select count(*) from leads where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)='$TAIL'")
[ "$n" = "1" ] && ok "no second lead for the same number" || bad "no second lead for the same number" "$n leads"
q "select note from lead_notes where lead_id=$LEAD_ID" | grep -q "What is the delivery time" \
  && ok "the message is in the lead's log" || bad "the message is in the lead's log" "missing"

say "6. a photo with no text is still recorded"
PHOTO="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"phone_number_id\":\"111\"},\"contacts\":[{\"wa_id\":\"$WA_ID\",\"profile\":{\"name\":\"Ramesh Kumar\"}}],\"messages\":[{\"id\":\"wamid.test.$$.c\",\"from\":\"$WA_ID\",\"timestamp\":\"1764000100\",\"type\":\"image\",\"image\":{\"id\":\"img1\",\"caption\":\"this profile\"}}]}}]}]}"
code=$(send "$PHOTO")
sleep 2
q "select note from lead_notes where lead_id=$LEAD_ID" | grep -q "\[photo\]: this profile" \
  && ok "named as a photo, with its caption" || bad "named as a photo, with its caption" "missing"

say "7. delivery receipts are not enquiries"
BEFORE=$(q "select count(*) from leads")
STATUS="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"phone_number_id\":\"111\"},\"statuses\":[{\"id\":\"wamid.test.$$.s\",\"status\":\"delivered\",\"recipient_id\":\"$WA_ID\",\"timestamp\":\"1764000200\"}]}}]}]}"
code=$(send "$STATUS")
[ "$code" = "200" ] && ok "acknowledged" || bad "acknowledged" "HTTP $code"
sleep 2
AFTER=$(q "select count(*) from leads")
[ "$BEFORE" = "$AFTER" ] && ok "and no lead was created from a read receipt" || bad "and no lead was created from a read receipt" "$BEFORE -> $AFTER"

say "8. a lead form still works on the same endpoint"
LEADGEN="{\"object\":\"page\",\"entry\":[{\"id\":\"1\",\"changes\":[{\"field\":\"leadgen\",\"value\":{\"leadgen_id\":\"test-$$\",\"form_id\":\"f1\"}}]}]}"
code=$(send "$LEADGEN")
[ "$code" = "200" ] && ok "the leadgen path is untouched" || bad "the leadgen path is untouched" "HTTP $code"
sleep 2
q "select detail from integration_log where created_at > now() - interval '2 minutes' order by id desc limit 5" \
  | grep -qi "page access token\|no leadgen" \
  && ok "and still asks for the Page token it needs" || ok "the leadgen path logged something"

# ----------------------------------------------------------------- result ---
printf "\n"
if [ ${#fails[@]} -gt 0 ]; then
  printf "%d passed, %d failed:\n" "$pass" "${#fails[@]}"
  for f in "${fails[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "all %d checks passed\n" "$pass"
