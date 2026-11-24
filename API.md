# Visbot Industries REST API v1

Base URL: `https://backend.visbot.in/api/v1`

Public, read-mostly JSON API serving the website, the mobile app and any other
client. No authentication or API key is needed. All origins are allowed, so a
web or hybrid build works without a proxy.

Every successful response is wrapped in an envelope:

```json
{ "data": ..., "meta": { ... } }
```

`meta` is present only where it is useful (counts, paging). Errors return a
non-2xx status with:

```json
{ "error": { "message": "No product with that slug." } }
```

Image fields are absolute URLs, ready to load directly. `web_url` points at the
matching page on the website, handy for a "view on website" link or for sharing.

GET responses carry `Cache-Control: public, max-age=300` and an `ETag`. Send the
ETag back as `If-None-Match` and you get a `304 Not Modified` with no body —
worth doing on mobile data.

---

## Endpoints

### `GET /`
Service information and the endpoint list.

### `GET /health`
`{ "data": { "ok": true, "db": "up" } }`. Returns 503 if the database is down.
Use this for uptime monitoring.

### `GET /categories`
The product sections, in display order.

```json
{ "data": [
    { "slug": "welding", "name": "Welding Machines",
      "count_label": "machines", "product_count": 6 }
  ],
  "meta": { "count": 5 } }
```

### `GET /products`
Machines shown in the catalogue.

| Query | Meaning |
|---|---|
| `category` | category slug, e.g. `welding` |
| `q` | text search over name, description and tagline |
| `limit` | 1–100, default 50 |
| `offset` | default 0 |
| `full=1` | include `overview`, `features` and `specs` on every item |

```json
{ "data": [
    { "slug": "v-cutting-machine",
      "name": "V Cutting Machine",
      "category": "cutting",
      "category_name": "Cutting Machines",
      "price": "₹1,00,000",
      "price_note": "onwards",
      "description": "Dual-blade 90° V-grooves in a single cycle for mullion joints.",
      "tagline": "…",
      "image": "https://visbot.in/assets/products/v-cutting.jpg",
      "web_url": "https://visbot.in/product/v-cutting-machine.html" }
  ],
  "meta": { "count": 21, "total": 21, "limit": 50, "offset": 0 } }
```

`image` is `null` when no photo exists yet — show a placeholder.

### `GET /products/{slug}`
One machine with everything, including the specification table.

```json
{ "data": {
    "slug": "v-cutting-machine",
    "name": "V Cutting Machine",
    "price": "₹1,00,000",
    "overview": "The V cutting machine creates the V-shaped grooves …",
    "features": ["<b>Pneumatic operation:</b> compressed air drives …"],
    "specs": [ { "label": "Input voltage", "value": "220 V 50 Hz / 380 V 50 Hz" } ],
    "spec_title": "Technical parameters",
    "note": null } }
```

404 if the slug is unknown.

**`features` entries contain `<b>` tags** — they are written that way for the
website. In a native app, either render them as rich text or strip the tags.

### `GET /spares`
Spares grouped by section.

```json
{ "data": [
    { "group": "Heating & Welding Spares",
      "items": [ { "name": "uPVC Heating Plate",
                   "description": "Cast aluminium plate, stable up to 350 °C…",
                   "image": "https://visbot.in/assets/products/heater-plate.jpg" } ] }
  ],
  "meta": { "count": 13 } }
```

### `GET /locations`
Factory, experience centre and proprietor cards. `address_lines` is the address
already split for display; `phones` is `[{ "number": "...", "label": "..." }]`.

### `GET /regional-contacts`
The state-wise sales numbers: `[{ "region": "Karnataka", "phone": "+91 93848 18404" }]`.

### `GET /catalogue`
**Use this on app startup.** Everything above in one request — categories,
products (full detail), spares, locations, regional contacts and the WhatsApp
number. About 37 KB, answered in a few milliseconds. Cache it locally and the
app works offline between refreshes.

```json
{ "data": { "categories": [...], "products": [...], "spares": [...],
            "locations": [...], "regional_contacts": [...],
            "whatsapp": "918072398966" },
  "meta": { "generated_at": "2026-11-19T…Z" } }
```

### `POST /enquiry`
Creates a lead in the admin panel's pipeline. Accepts JSON or form-encoded.

```json
{ "name": "Ramesh Kumar",          // required
  "phone": "+91 98765 43210",
  "email": "ramesh@example.com",
  "city": "Coimbatore",
  "state": "Tamil Nadu",
  "interest": "Double Head Welding Machine",
  "message": "Need a quote for 2 units.",
  "source": "app" }                 // "app" or "website"
```

- `201` → `{ "data": { "ok": true, "id": 42 } }`
- `400` if `name` is missing
- `429` if more than 6 enquiries come from one IP in a minute

Pass `source: "app"` so the sales team can see in the admin panel that the lead
came from the mobile app. Set `interest` to the product name the user was
viewing — it shows directly in the lead list and drives the "most asked about"
report.

---

## Notes for the app build

- **Prices are strings**, already formatted in rupees (`"₹1,00,000"`, or
  `"Price on request"`). They are display values, not numbers to compute with.
- **Slugs are the stable identifier.** Database ids are not exposed.
- Product photos are roughly 80–170 KB each, around 800 px wide. Request them
  at the size you need and cache them; they are served with a 30-day cache.
- **An enquiry is a `POST`, not a WhatsApp message.** The website's form posts
  here and confirms on the page; the lead is in the pipeline the moment it
  answers. Do the same in the app rather than opening `wa.me`: a chat the
  pipeline never sees is a lead nobody follows up. The WhatsApp number from
  `/catalogue` is for a customer who wants to *chat*, alongside the enquiry.
- **Send a real `state`.** It is matched against the states table — aliases and
  casing included — and that is what decides which sales rep the lead reaches.
  A state that matches nothing leaves the lead outside every territory, so
  offer the list from `/regional-contacts` or a fixed list rather than a free
  text box.
- Content is edited in the admin panel at `https://admin.visbot.in`, so the API
  reflects changes immediately. Honour the 5-minute cache window rather than
  polling hard.
- This API is public and read-mostly. The sales team's own app — leads assigned
  to a rep, and the customer reviews they collect — signs in with a token
  against `/api/app`, documented in [API-APP.md](API-APP.md).
- Click-to-WhatsApp enquiries can be captured automatically once a number is on
  the WhatsApp Cloud API; the setup is in [WHATSAPP.md](WHATSAPP.md). The
  WhatsApp Business *app* has no API, so its chats cannot be read by anything.
