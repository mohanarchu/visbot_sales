# WhatsApp Cloud API — setting it up

How to get click-to-WhatsApp enquiries into the Visbot panel automatically.

Everything in Part 1 happens on Meta's side and only you can do it — it needs
your business details, your phone and your card. Part 2 is the handful of values
to bring back. Part 3 is what gets built here afterwards.

Meta renames things in this dashboard often, so a label may read slightly
differently from what is written below; the order of the work does not change.

---

## Before you start: the one decision

A phone number can live **either** in the WhatsApp Business app **or** on the
Cloud API. Never both.

**Use a new number.** Buy a fresh SIM for the ads, put that on the Cloud API,
and leave your existing number in the WhatsApp Business app exactly as it is.
Your team keeps replying on the phone as they do today, existing customers are
undisturbed, and only the ad enquiries go through the new number.

If instead you move your current number, the WhatsApp Business app stops working
for it the moment it is registered, and every reply from then on has to come
from a web inbox. Don't do that first — do it later, if ever, once the new
number has proved itself.

The new number must not be registered on WhatsApp at all. If it has been, delete
that account in the app first (Settings → Account → Delete account) and wait a
few hours.

---

## Part 1 — on Meta's side

### 1. A Business portfolio

[business.facebook.com](https://business.facebook.com) → Settings → Business
portfolio → **Create**. Use the Visbot name, address and a business email.

This is the step that produced the "no account linked" message. Nothing else
works without it.

While you are there, start **Business verification** (Security Centre →
Verify). It needs your GST certificate or incorporation papers and takes a few
days. You can keep going without it, but messaging limits stay low until it
passes.

### 2. Bring the Page in (if you have one)

Business Settings → Accounts → Pages → **Add** → *Add an existing Page*. Not
required for WhatsApp, but it is what lets you run the ads from Ads Manager
later, and it keeps everything in one portfolio.

### 3. Create the app

[developers.facebook.com](https://developers.facebook.com) → My Apps → **Create
App**:

* Use case: **Other** → type: **Business**
* Business portfolio: the one from step 1

Then on the app dashboard, find **WhatsApp** in the product list and press
*Set up*. That creates a WhatsApp Business Account (WABA) for you and gives you
a free test number.

### 4. Register the real number

App dashboard → **WhatsApp → API Setup** → *Add phone number*.

* Display name — what customers see. Meta reviews it, so use "Visbot
  Industries", not a slogan. A rejected name is the usual reason this stalls.
* Category: choose the manufacturing / industrial option.
* Verify by SMS or voice call on that SIM.

Keep the **Phone number ID** and the **WhatsApp Business Account ID** shown on
this page. They are not the phone number itself; they are the ids the API uses.

### 5. A permanent token

The token the dashboard shows you expires in 24 hours. It is fine for a first
test and useless for a server, so make a System User token:

Business Settings → Users → **System Users** → *Add* → name it
`visbot-server`, role **Admin**.

Then, for that system user:

* **Add assets** → Apps → your app → *Manage app*
* **Add assets** → WhatsApp accounts → your WABA → *Manage*
* **Generate new token** → pick the app → tick
  `whatsapp_business_messaging` and `whatsapp_business_management`
  → set expiry **Never**

Copy the token once; it is never shown again.

### 6. Payment method

Business Settings → Payment methods → add a card against the WABA. Meta charges
per conversation, and ad-driven conversations have had a free window — the rules
change often, so check the current rates in the WhatsApp Manager before you
budget. Without a payment method, messaging stops after the free allowance.

### 7. The webhook

App dashboard → **WhatsApp → Configuration** → Webhook → *Edit*:

* **Callback URL:** `https://backend.visbot.in/api/whatsapp/webhook`
* **Verify token:** the one shown on the admin panel's WhatsApp page

Press *Verify and save*. Then under **Webhook fields**, subscribe to
**`messages`**. That one field carries incoming messages and the ad referral.

The callback URL needs no server work — `backend.visbot.in` already proxies
every path to the backend, and the endpoint refuses anything unsigned.

### 8. Point the ads at the new number

This is the part that changes your routine. Ads created from inside the WhatsApp
Business app go to that app's number, so they have to be created from **Ads
Manager** (or Meta Business Suite) instead, with the destination set to the new
Cloud API number.

While you are in the ad setup, give each ad a **different pre-filled message**
("I want the welding machine price", "I want service support"). The webhook
records it, so you can see which ad produced which enquiry even before anyone
replies.

---

## Part 2 — what to bring back

Six values, which go into the admin panel (Integrations → WhatsApp) or into
`server/.env`:

| Value | Where it was shown |
|---|---|
| App ID | app dashboard, top |
| App Secret | app → Settings → Basic → *Show* |
| WhatsApp Business Account ID | WhatsApp → API Setup |
| Phone number ID | WhatsApp → API Setup |
| Permanent access token | the System User token from step 5 |
| Verify token | generated for you on the admin page |

The secret and the token are stored in your own PostgreSQL `settings` table and
masked after saving, the same way the Meta lead-ads credentials are.

---

## Part 3 — what gets built here

Once those values exist:

* `POST /api/whatsapp/webhook` — verifies Meta's `X-Hub-Signature-256` against
  the App Secret, the same way the Meta lead-ads webhook already does, and
  refuses anything unsigned.
* An incoming message becomes a lead: the sender's WhatsApp profile name, their
  number, source **WhatsApp**, and, when the chat came from an ad, the ad
  headline and the pre-filled text kept as the campaign.
* De-duplicated on the number, so a customer who writes three times is one lead
  with three notes rather than three leads.
* Every delivery recorded in the integration log, successful or not, so a
  missing enquiry can be traced.
* A WhatsApp panel beside the Meta one: the credentials, the webhook URL, the
  last delivery, and the log.

### One limitation, stated plainly

A WhatsApp message gives us a name and a number — **not a state**. Territory
routing needs the state, so an auto-created lead arrives unassigned and sits in
the office list until somebody sets the state, after which it lands with the rep
who covers it. Unavoidable: the customer never typed it.

---

## Testing it

1. From your personal WhatsApp, message the new number. A lead should appear in
   the panel within seconds, and the delivery log should show the call.
2. Use the ad preview to tap through a real click-to-WhatsApp ad. That lead
   should carry the campaign.
3. If nothing arrives: check the delivery log first. A rejected signature means
   the App Secret is wrong; nothing at all means the `messages` field is not
   subscribed, or the ad still points at the old number.
