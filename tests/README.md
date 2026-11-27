# Checks

Plain scripts, no framework. They run against the **local** servers
(`cd server && node bin/all.js`) and the local database, and they clean up the
rows they create.

```sh
node tests/check-imports.mjs    # every named import in admin-app/ resolves
node tests/enquiry-form.mjs     # the website's enquiry form: posts, confirms, never opens WhatsApp
node tests/state-field.mjs      # the admin panel's state picker
node tests/pager.mjs            # the pager: what it renders, and the links it points at
node tests/referrals-ui.mjs      # the referral questions and pages, and that their classes exist
bash tests/territory.sh         # states, who covers what, and the lead list each rep gets
bash tests/pagination.sh        # every list pages, honours ?per_page, and ?all=1 still works
bash tests/date-filter.sh       # the lead date filter, including what "today" means in Coimbatore
bash tests/referrals.sh         # referral leads: who referred them, and what the fee is
bash tests/whatsapp-webhook.sh  # WhatsApp messages becoming leads, without duplicates
```

Run the lot:

```sh
# dom-shim.mjs is the browser stand-in the others import, not a test of its own.
for f in tests/*.mjs; do [ "$f" = tests/dom-shim.mjs ] || node "$f" || break; done
for f in tests/*.sh; do bash "$f" || break; done
```

`enquiry-form.mjs` runs `js/main.js` in node against a hand-built DOM, so the
form can be checked without a browser. It covers the two paths that matter: a
lead reaching the server, and a failure the visitor is actually told about
rather than a confirmation for an enquiry that was never recorded.

`pager.mjs` and `referrals-ui.mjs` run the panel's own modules in node against
`dom-shim.mjs`, a small stand-in for the browser. They cover the things that are
invisible when they break: a pager that renders nothing, and a required field
left switched on inside a hidden section, which blocks a form with nothing on
screen to say why.

`territory.sh` reads the administrator's credentials from `server/.env`, signs
in to the panel, creates a couple of sales accounts and some leads, checks what
each account can see through the sales API, and deletes it all again. It leaves
anything it did not create alone.

The sales app has its own tests, in `../visbot_sales`:

```sh
cd ../visbot_sales && flutter test        # offline
# and, against a running local backend:
VISBOT_LIVE_BASE=http://127.0.0.1:9001 \
VISBOT_LIVE_USER=<a sales mobile or email> VISBOT_LIVE_PASS=<password> \
  flutter test test/live_api_test.dart
```
