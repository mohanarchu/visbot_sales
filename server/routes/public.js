const router = require("express").Router();
const db = require("../db");
const serviceSettings = require("../service-settings");
const states = require("../states");

const WA = process.env.WA_NUMBER || "918072398966";

function plain(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function waLink(name) {
  return (
    "https://wa.me/" + WA + "?text=" +
    encodeURIComponent("Hello Visbot, I would like to enquire about the " + plain(name) + ".")
  );
}

// Every "Enquire" button on the site points here: the contact form, with the
// machine or spare carried across, so submitting it creates a lead in the admin
// panel. A WhatsApp link would start a chat that the pipeline never sees.
function enquireLink(name) {
  return "/contact.html?interest=" + encodeURIComponent(plain(name)) + "#enquiry";
}

router.get("/products.html", async (req, res, next) => {
  try {
    const cats = (await db.query("SELECT * FROM categories ORDER BY sort_order, id")).rows;
    const prods = (
      await db.query("SELECT * FROM products WHERE show_in_grid ORDER BY sort_order, id")
    ).rows;
    const byCat = {};
    for (const p of prods) (byCat[p.category_id] ||= []).push(p);
    res.render("products", { cats, byCat, waLink, enquireLink, WA });
  } catch (e) { next(e); }
});

router.get("/product/:page", async (req, res, next) => {
  try {
    const slug = req.params.page.replace(/\.html$/, "");
    const r = await db.query("SELECT * FROM products WHERE slug = $1", [slug]);
    if (!r.rows.length) return next();
    res.render("product", { p: r.rows[0], plain, waLink, enquireLink, WA });
  } catch (e) { next(e); }
});

router.get("/service.html", async (req, res, next) => {
  try {
    // The machine list comes from the catalogue so it stays in step with it,
    // and the helpline numbers from the admin panel's Helpline details.
    const products = (await db.query(
      "SELECT name FROM products WHERE show_in_grid ORDER BY name")).rows;
    const svc = await serviceSettings.get();

    // Only published reviews ever reach the page.
    const reviews = (await db.query(
      `SELECT customer, company, city, state, machine, rating, comment, created_at
       FROM service_reviews WHERE published ORDER BY created_at DESC LIMIT 9`)).rows;
    const avg = reviews.length
      ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10
      : null;

    res.render("service", { products, WA, svc, dial: serviceSettings.dial, reviews, avg });
  } catch (e) { next(e); }
});

router.get("/spares.html", async (req, res, next) => {
  try {
    const groups = (await db.query("SELECT * FROM spare_groups ORDER BY sort_order, id")).rows;
    const spares = (await db.query("SELECT * FROM spares ORDER BY sort_order, id")).rows;
    const byGroup = {};
    for (const s of spares) (byGroup[s.group_id] ||= []).push(s);
    res.render("spares", { groups, byGroup, enquireLink, WA });
  } catch (e) { next(e); }
});

router.get("/contact.html", async (req, res, next) => {
  try {
    const locations = (await db.query("SELECT * FROM locations ORDER BY sort_order, id")).rows;
    const regions = (
      await db.query("SELECT * FROM regional_contacts ORDER BY sort_order, id")
    ).rows;
    res.render("contact", { locations, regions, WA, states: await states.list() });
  } catch (e) { next(e); }
});

module.exports = router;
