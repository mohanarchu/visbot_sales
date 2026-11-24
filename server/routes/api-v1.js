// Public REST API v1 — served by the backend app at backend.visbot.in/api/v1.
// Built for the mobile app and any other client: JSON only, absolute image
// URLs, no session, cacheable GETs.
const router = require("express").Router();
const db = require("../db");

const SITE = (process.env.SITE_URL || "https://visbot.in").replace(/\/$/, "");
const imageUrl = (file) => (file ? `${SITE}/assets/products/${file}` : null);
const pageUrl = (slug) => `${SITE}/product/${slug}.html`;

// Read endpoints are safe to cache briefly; Express adds an ETag so a client
// that already has the data gets a 304 instead of the body.
function cacheable(res, seconds = 300) {
  res.set("Cache-Control", `public, max-age=${seconds}`);
}

const ok = (res, data, meta) => res.json(meta ? { data, meta } : { data });

function productSummary(p) {
  return {
    slug: p.slug,
    name: p.name,
    category: p.category_slug || null,
    category_name: p.category_name || null,
    price: p.price,
    price_note: p.price_note || null,
    description: p.card_desc || null,
    tagline: p.tag || null,
    image: imageUrl(p.image),
    web_url: pageUrl(p.detail_slug || p.slug),
  };
}

function productFull(p) {
  return Object.assign(productSummary(p), {
    overview: p.intro || null,
    features: p.features || [],
    specs: (p.specs || []).map(([label, value]) => ({ label, value })),
    spec_title: p.spec_title || "Technical parameters",
    note: p.note || null,
  });
}

// ---------- service info ----------
router.get("/", (req, res) => {
  cacheable(res, 3600);
  ok(res, {
    service: "Visbot Industries API",
    version: "1",
    endpoints: [
      "GET  /api/v1/health",
      "GET  /api/v1/categories",
      "GET  /api/v1/products?category=&q=&limit=&offset=",
      "GET  /api/v1/products/:slug",
      "GET  /api/v1/spares",
      "GET  /api/v1/locations",
      "GET  /api/v1/regional-contacts",
      "GET  /api/v1/catalogue",
      "POST /api/v1/enquiry",
    ],
  });
});

router.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ data: { ok: true, db: "up" } });
  } catch {
    res.status(503).json({ error: { message: "database unavailable" } });
  }
});

// ---------- catalogue ----------
router.get("/categories", async (req, res, next) => {
  try {
    const rows = (await db.query(
      `SELECT c.slug, c.name, c.count_label,
              (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.show_in_grid)::int AS product_count
       FROM categories c ORDER BY c.sort_order, c.id`)).rows;
    cacheable(res);
    ok(res, rows, { count: rows.length });
  } catch (e) { next(e); }
});

router.get("/products", async (req, res, next) => {
  try {
    const where = ["p.show_in_grid"];
    const params = [];
    if (req.query.category) {
      params.push(req.query.category);
      where.push(`c.slug = $${params.length}`);
    }
    if (req.query.q) {
      params.push("%" + String(req.query.q).trim() + "%");
      const i = params.length;
      where.push(`(p.name ILIKE $${i} OR p.card_desc ILIKE $${i} OR p.tag ILIKE $${i})`);
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const clause = "WHERE " + where.join(" AND ");
    const total = parseInt((await db.query(
      `SELECT count(*) FROM products p LEFT JOIN categories c ON c.id = p.category_id ${clause}`,
      params)).rows[0].count, 10);

    const rows = (await db.query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${clause}
       ORDER BY c.sort_order NULLS LAST, p.sort_order, p.id
       LIMIT ${limit} OFFSET ${offset}`, params)).rows;

    cacheable(res);
    ok(res, rows.map(req.query.full === "1" ? productFull : productSummary),
      { count: rows.length, total, limit, offset });
  } catch (e) { next(e); }
});

router.get("/products/:slug", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.slug = $1`, [req.params.slug]);
    if (!r.rows.length) {
      return res.status(404).json({ error: { message: "No product with that slug." } });
    }
    cacheable(res);
    ok(res, productFull(r.rows[0]));
  } catch (e) { next(e); }
});

router.get("/spares", async (req, res, next) => {
  try {
    const groups = (await db.query("SELECT id, name FROM spare_groups ORDER BY sort_order, id")).rows;
    const spares = (await db.query("SELECT * FROM spares ORDER BY sort_order, id")).rows;
    const byGroup = {};
    for (const s of spares) (byGroup[s.group_id] ||= []).push({
      name: s.name,
      description: s.description || null,
      image: imageUrl(s.image),
    });
    cacheable(res);
    ok(res, groups.map((g) => ({ group: g.name, items: byGroup[g.id] || [] })),
      { count: spares.length });
  } catch (e) { next(e); }
});

// ---------- contact ----------
router.get("/locations", async (req, res, next) => {
  try {
    const rows = (await db.query("SELECT * FROM locations ORDER BY sort_order, id")).rows;
    cacheable(res);
    ok(res, rows.map((l) => ({
      title: l.title,
      address: l.address || null,
      address_lines: l.address ? l.address.split("\n") : [],
      phones: l.phones || [],
      map_url: l.map_url || null,
    })), { count: rows.length });
  } catch (e) { next(e); }
});

router.get("/regional-contacts", async (req, res, next) => {
  try {
    const rows = (await db.query(
      "SELECT region, phone FROM regional_contacts ORDER BY sort_order, id")).rows;
    cacheable(res);
    ok(res, rows, { count: rows.length });
  } catch (e) { next(e); }
});

// ---------- one-shot bootstrap for the mobile app ----------
// Everything the app needs to render offline, in a single request.
router.get("/catalogue", async (req, res, next) => {
  try {
    const cats = (await db.query("SELECT * FROM categories ORDER BY sort_order, id")).rows;
    const prods = (await db.query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order NULLS LAST, p.sort_order, p.id`)).rows;
    const groups = (await db.query("SELECT id, name FROM spare_groups ORDER BY sort_order, id")).rows;
    const spares = (await db.query("SELECT * FROM spares ORDER BY sort_order, id")).rows;
    const locations = (await db.query("SELECT * FROM locations ORDER BY sort_order, id")).rows;
    const regions = (await db.query(
      "SELECT region, phone FROM regional_contacts ORDER BY sort_order, id")).rows;

    const byGroup = {};
    for (const s of spares) (byGroup[s.group_id] ||= []).push({
      name: s.name, description: s.description || null, image: imageUrl(s.image),
    });

    cacheable(res);
    ok(res, {
      categories: cats.map((c) => ({ slug: c.slug, name: c.name, count_label: c.count_label })),
      products: prods.filter((p) => p.show_in_grid).map(productFull),
      spares: groups.map((g) => ({ group: g.name, items: byGroup[g.id] || [] })),
      locations: locations.map((l) => ({
        title: l.title,
        address_lines: l.address ? l.address.split("\n") : [],
        phones: l.phones || [],
        map_url: l.map_url || null,
      })),
      regional_contacts: regions,
      whatsapp: process.env.WA_NUMBER || "918072398966",
    }, { generated_at: new Date().toISOString() });
  } catch (e) { next(e); }
});

// ---------- enquiry ----------
// Same capture as the website form, so app enquiries land in the same pipeline.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > 6;
}

router.post("/enquiry", async (req, res) => {
  try {
    if (throttled(req.ip)) {
      return res.status(429).json({ error: { message: "Too many enquiries. Try again shortly." } });
    }
    const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const name = clip(req.body.name, 120);
    if (!name) {
      return res.status(400).json({ error: { message: "A name is required." } });
    }
    const source = req.body.source === "app" ? "app" : "website";

    const r = await db.query(
      `INSERT INTO leads (name, phone, email, city, state, interest, message, source, status, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new','medium') RETURNING id`,
      [name, clip(req.body.phone, 40), clip(req.body.email, 160), clip(req.body.city, 80),
       clip(req.body.state, 80), clip(req.body.interest, 160), clip(req.body.message, 4000), source]
    );
    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,'created')",
      [r.rows[0].id, source === "app"
        ? "Submitted an enquiry from the mobile app."
        : "Submitted the enquiry form on the website."]
    );
    res.status(201).json({ data: { ok: true, id: r.rows[0].id } });
  } catch (e) {
    console.error("api enquiry failed:", e.message);
    res.status(500).json({ error: { message: "Could not save the enquiry." } });
  }
});

// JSON errors, never an HTML stack trace.
router.use((err, req, res, next) => {
  console.error("api error:", err.message);
  res.status(500).json({ error: { message: "Server error." } });
});

module.exports = router;
