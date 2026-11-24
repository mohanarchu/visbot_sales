// Public JSON API served by the backend app (port 9001 / backend.visbot.in).
const router = require("express").Router();
const db = require("../db");

// ---------- enquiry capture ----------
// The website contact form posts here before it opens WhatsApp, so every
// enquiry becomes a lead even if the visitor never sends the message.
const hits = new Map(); // ip -> timestamps, coarse flood protection
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > 6;
}

router.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, service: "visbot-backend", db: "up" });
  } catch {
    res.status(503).json({ ok: false, service: "visbot-backend", db: "down" });
  }
});

router.post("/enquiry", async (req, res) => {
  try {
    if (throttled(req.ip)) return res.status(429).json({ ok: false });

    const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const name = clip(req.body.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: "name required" });

    const r = await db.query(
      `INSERT INTO leads (name, phone, email, state, interest, message, source, status, priority)
       VALUES ($1,$2,$3,$4,$5,$6,'website','new','medium') RETURNING id`,
      [name, clip(req.body.phone, 40), clip(req.body.email, 160), clip(req.body.state, 80),
       clip(req.body.interest, 160), clip(req.body.message, 4000)]
    );
    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,'created')",
      [r.rows[0].id, "Submitted the enquiry form on the website."]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error("enquiry capture failed:", e.message);
    res.status(500).json({ ok: false });
  }
});

// ---------- service requests ----------
// Raised by existing customers from the website's Service page. Stored apart
// from sales leads: these are warranty and breakdown calls, not enquiries, so
// they would distort the sales pipeline figures.
router.post("/service", async (req, res) => {
  try {
    if (throttled(req.ip)) return res.status(429).json({ ok: false });

    const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const name = clip(req.body.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: "name required" });

    const r = await db.query(
      `INSERT INTO service_requests
         (name, phone, email, city, state, reference, machine, issue, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'website') RETURNING id`,
      [name, clip(req.body.phone, 40), clip(req.body.email, 160), clip(req.body.city, 80),
       clip(req.body.state, 80), clip(req.body.reference, 120), clip(req.body.machine, 160),
       clip(req.body.issue, 4000)]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error("service capture failed:", e.message);
    res.status(500).json({ ok: false });
  }
});

// Reviews have no capture endpoint on purpose: they are entered in the admin
// panel, and the website only shows the ones published there.

module.exports = router;
