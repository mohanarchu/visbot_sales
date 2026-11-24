# Visbot Sales app API

Base URL: `https://backend.visbot.in/api/app`

The private half of the backend, used by the Visbot Sales mobile app
(`~/Documents/Projects/Own/visbot_sales`). Everything except `GET /` and
`POST /login` needs a bearer token:

```
Authorization: Bearer <token>
```

Tokens are used instead of cookies, so there is nothing a browser attaches on
its own and no CSRF surface. Only the SHA-256 of a token is stored, so a leaked
database row cannot be signed in with. A token lasts 60 days and its expiry
slides forward on every call, so an app in regular use never asks for the
password again. It stops working at once when the account is switched off, when
the password is changed, or on sign-out.

Responses use the same envelope as v1:

```json
{ "data": ..., "meta": { ... }, "message": "Saved." }
```

`message` is written for the person to read and the app shows it as it is.
Errors return a non-2xx status with `{ "error": { "message": "..." } }`.

## Who can sign in

Accounts and roles are managed in the admin panel under **People › Panel
users**. There is no username: a person signs in with their **mobile number or
their email address**, whichever the office has for them, and at least one of
the two is required. A number is matched on its last ten digits, so
`9876543210`, `98765 43210`, `+91 98765 43210` and `09876543210` are all the
same person; an email is matched without case. Neither can be shared by two
accounts.

A password is set in the panel on the same form as the rest of the account —
leave the box empty to keep the one already in use. Changing it deletes every
token for that account, so their phone signs in again; a browser session already
open lasts until it expires.

The role decides what the account can reach — the table lives in
`server/users.js`:

| Role | Web panel | Sales app | Leads it sees | Manages users |
|---|---|---|---|---|
| `admin` | yes | yes | all | yes |
| `manager` | yes | yes | all | no |
| `sales` | **no** | yes | its own, plus its states | no |

### What a sales account sees

Two things, together:

* every lead **assigned to them**, wherever in the country it is, and
* every lead in a **state they cover** that nobody else has been given.

So a territory brings in the new enquiries from it, and an explicit assignment
always wins — two reps covering one state never both chase the same customer.
A rep with no states sees only what is assigned to them by name.

States are set per person in the admin panel, on the user's own form. The list
of states lives in the database (`schema-states.sql`: all 28 states and 8 union
territories). A lead's `state` is free text typed by a customer or a rep, so it
is resolved to one row on the way in by a database trigger — "Tamil Nadu",
"tamilnadu", "TN" and "Tamil-Nadu" are one state. A spelling nobody recognises
leaves the lead in no state, where only an explicit assignment reaches it.

A sales account is turned away from `admin.visbot.in`, and the built-in
administrator from `.env` is turned away from the app (it has no database row,
so nothing can be assigned to it). That account is still matched by whatever
`ADMIN_USER` is set to, and a user row reachable by the same number or address
is refused, so it can never be shadowed.

Lead scoping is applied inside each query rather than checked afterwards: a rep
asking for someone else's lead by id gets a plain 404.

---

## Endpoints

### `GET /`
Service information and the endpoint list. No token needed.

### `POST /login`
```json
{ "identifier": "9876543210", "password": "…", "device": "android" }
```
`identifier` is a mobile number or an email address. (`username` is still read
instead, so an older build of the app keeps working.) Returns
`{ "data": { "token", "expires_in_days", "user" } }`, where `user.login_id` is
what they typed, for showing back to them. Failures are counted per IP **and**
per identifier: ten in fifteen minutes locks that pair out, so one rep's typo
cannot lock out the office.

### `POST /logout`
Deletes this token. Other devices stay signed in.

### `GET /me`
The signed-in account, including its `can` table.

### `POST /me/password`
```json
{ "current_password": "…", "password": "…" }
```
At least 8 characters. Every token for the account is dropped, this one
included, so the app signs in again.

### `GET /bootstrap`
Everything the forms need, in one call: `statuses`, `sources`, `priorities`,
`machines` (the website's own catalogue, so the names match what the office
quotes), `helpline`, `can_assign`, and `team` when the account may assign.
Also `states` — every state, for the state field on a lead — and `my_states`,
the ones this person covers.

### `GET /dashboard`
`stats` (total, new, open, won, this month, follow-ups due), `due` (the next ten
follow-ups), and the account's own review tally. Scoped to the caller.

### `GET /leads`
Query: `status`, `source`, `state` (a state id), `q`, `due=1`, `open=1`, `page`.
25 per page. `state` can only narrow what the account already sees, never widen
it.
Returns the leads plus `meta` paging and `status_counts` for the filter chips.

### `POST /leads`
Needs a `name` and either a phone number or an email address — a lead nobody
can be rung back on is refused rather than saved. A sales account's new lead is
assigned to them whatever the request says. `source` defaults to `app`.

### `GET /leads/:id`
`{ "lead": …, "notes": [ … ] }`, newest note first. Each note carries the
`author` who wrote it.

### `PUT /leads/:id`
Any field left out keeps the value it had, so the app can send one edited
field. Only `admin` and `manager` may change `owner_user_id`.

### `POST /leads/:id/status`
```json
{ "status": "quoted" }
```
Also writes a line in the activity log.

### `POST /leads/:id/notes`
```json
{ "note": "Called, asked for a price list", "kind": "call", "next_followup": "2026-12-15" }
```
`kind` is `call`, `visit` or `note`. Either the note or the date is enough.

### `GET /reviews`
The reviews this account collected, with `counts` (total, published, pending).

### `POST /reviews`
```json
{ "customer": "…", "company": "…", "city": "…", "state": "…",
  "machine": "…", "rating": 5, "comment": "…" }
```
`customer`, `rating` (1–5) and `comment` are required. The review is saved
**unpublished** with `source: "app"` and stamped with who collected it. It
appears in the admin panel under **Service › Customer reviews** as waiting, and
only reaches visbot.in when somebody there publishes it.

---

## Notes

* No nginx change was needed: `backend.visbot.in` already proxies every path to
  the backend service on port 9001.
* CORS is open on `/api/app` (`Access-Control-Allow-Origin: *`,
  `Authorization` allowed). That is safe here because the API is token-based and
  sends no cookies; it means a web or desktop build of the app also works.
* The catalogue, spares, locations and the public enquiry form are in the open
  v1 API — see [API.md](API.md). The app uses both.
