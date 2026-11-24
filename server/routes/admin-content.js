// Website content management: categories, products, spares, locations, regional contacts.
// Mounted under /admin — authentication and flash handling happen in routes/admin.js.
const router = require("express").Router();
const db = require("../db");
const {
  upload, listImages, linesToFeatures, linesToSpecs, linesToPhones,
  pickImage, intOr0, flash,
} = require("../admin-util");

// ---------- website overview ----------
router.get("/website", async (req, res, next) => {
  try {
    const counts = (await db.query(
      `SELECT (SELECT count(*) FROM categories) cats, (SELECT count(*) FROM products) products,
              (SELECT count(*) FROM spare_groups) groups, (SELECT count(*) FROM spares) spares,
              (SELECT count(*) FROM locations) locations, (SELECT count(*) FROM regional_contacts) regions`
    )).rows[0];

    const byCategory = (await db.query(
      `SELECT c.id, c.name, c.slug, count(p.id)::int AS n
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.sort_order, c.id`
    )).rows;

    const noPhoto = (await db.query(
      `SELECT 'product' AS kind, id, name FROM products WHERE image IS NULL OR image = ''
       UNION ALL
       SELECT 'spare' AS kind, id, name FROM spares WHERE image IS NULL OR image = ''
       ORDER BY kind, name`
    )).rows;

    const orphans = (await db.query(
      "SELECT id, name FROM products WHERE category_id IS NULL ORDER BY name"
    )).rows;

    res.render("admin/website", { counts, byCategory, noPhoto, orphans });
  } catch (e) { next(e); }
});

// ---------- categories ----------
router.get("/categories", async (req, res, next) => {
  try {
    const cats = (await db.query(
      `SELECT c.*, (SELECT count(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.sort_order, c.id`)).rows;
    res.render("admin/categories", { cats });
  } catch (e) { next(e); }
});
router.get("/categories/new", (req, res) => res.render("admin/category-form", { c: null }));
router.get("/categories/:id/edit", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM categories WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/categories");
    res.render("admin/category-form", { c: r.rows[0] });
  } catch (e) { next(e); }
});
router.post("/categories/:id/delete", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM categories WHERE id=$1 RETURNING name", [req.params.id]);
    flash(req, r.rows.length ? `Category “${r.rows[0].name}” deleted.` : "Category deleted.");
    res.redirect("/admin/categories");
  } catch (e) { next(e); }
});
router.post("/categories/:id?", async (req, res, next) => {
  try {
    const b = req.body;
    const vals = [b.name, b.slug, b.count_label || "machines", intOr0(b.cols) || 3, intOr0(b.sort_order)];
    if (req.params.id) {
      await db.query(
        "UPDATE categories SET name=$1, slug=$2, count_label=$3, cols=$4, sort_order=$5 WHERE id=$6",
        [...vals, req.params.id]);
      flash(req, `Category “${b.name}” saved.`);
    } else {
      await db.query(
        "INSERT INTO categories (name, slug, count_label, cols, sort_order) VALUES ($1,$2,$3,$4,$5)", vals);
      flash(req, `Category “${b.name}” created.`);
    }
    res.redirect("/admin/categories");
  } catch (e) { next(e); }
});

// ---------- products ----------
router.get("/products", async (req, res, next) => {
  try {
    const products = (await db.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order NULLS LAST, p.sort_order, p.id`)).rows;
    const cats = (await db.query("SELECT * FROM categories ORDER BY sort_order, id")).rows;
    res.render("admin/products", { products, cats });
  } catch (e) { next(e); }
});
router.get("/products/new", async (req, res, next) => {
  try {
    const cats = (await db.query("SELECT * FROM categories ORDER BY sort_order, id")).rows;
    res.render("admin/product-form", {
      p: null, cats, images: listImages(), presetCategory: req.query.category || null,
    });
  } catch (e) { next(e); }
});
router.get("/products/:id/edit", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM products WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/products");
    const cats = (await db.query("SELECT * FROM categories ORDER BY sort_order, id")).rows;
    res.render("admin/product-form", { p: r.rows[0], cats, images: listImages(), presetCategory: null });
  } catch (e) { next(e); }
});
router.post("/products/:id/delete", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM products WHERE id=$1 RETURNING name", [req.params.id]);
    flash(req, r.rows.length ? `Product “${r.rows[0].name}” deleted.` : "Product deleted.");
    res.redirect("/admin/products");
  } catch (e) { next(e); }
});
router.post("/products/:id?", upload.single("image_file"), async (req, res, next) => {
  try {
    const b = req.body;
    const vals = [
      b.category_id || null, b.slug, b.name,
      b.price || "Price on request", b.price_note || null,
      pickImage(req), b.card_desc || null, b.tag || null, b.intro || null,
      b.spec_title || null, b.note || null,
      JSON.stringify(linesToFeatures(b.features)),
      JSON.stringify(linesToSpecs(b.specs)),
      b.show_in_grid === "on", b.detail_slug || null, intOr0(b.sort_order),
    ];
    if (req.params.id) {
      await db.query(
        `UPDATE products SET category_id=$1, slug=$2, name=$3, price=$4, price_note=$5, image=$6,
         card_desc=$7, tag=$8, intro=$9, spec_title=$10, note=$11, features=$12, specs=$13,
         show_in_grid=$14, detail_slug=$15, sort_order=$16 WHERE id=$17`,
        [...vals, req.params.id]);
      flash(req, `Product “${b.name}” saved.`);
    } else {
      await db.query(
        `INSERT INTO products (category_id, slug, name, price, price_note, image, card_desc, tag,
         intro, spec_title, note, features, specs, show_in_grid, detail_slug, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, vals);
      flash(req, `Product “${b.name}” created.`);
    }
    res.redirect("/admin/products");
  } catch (e) { next(e); }
});

// ---------- spare groups ----------
router.get("/spare-groups/new", (req, res) => res.render("admin/group-form", { g: null }));
router.get("/spare-groups/:id/edit", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM spare_groups WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/spares");
    res.render("admin/group-form", { g: r.rows[0] });
  } catch (e) { next(e); }
});
router.post("/spare-groups/:id/delete", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM spare_groups WHERE id=$1 RETURNING name", [req.params.id]);
    flash(req, r.rows.length ? `Group “${r.rows[0].name}” and its spares deleted.` : "Group deleted.");
    res.redirect("/admin/spares");
  } catch (e) { next(e); }
});
router.post("/spare-groups/:id?", async (req, res, next) => {
  try {
    const vals = [req.body.name, intOr0(req.body.sort_order)];
    if (req.params.id) {
      await db.query("UPDATE spare_groups SET name=$1, sort_order=$2 WHERE id=$3", [...vals, req.params.id]);
      flash(req, `Group “${req.body.name}” saved.`);
    } else {
      await db.query("INSERT INTO spare_groups (name, sort_order) VALUES ($1,$2)", vals);
      flash(req, `Group “${req.body.name}” created.`);
    }
    res.redirect("/admin/spares");
  } catch (e) { next(e); }
});

// ---------- spares ----------
router.get("/spares", async (req, res, next) => {
  try {
    const groups = (await db.query("SELECT * FROM spare_groups ORDER BY sort_order, id")).rows;
    const spares = (await db.query("SELECT * FROM spares ORDER BY sort_order, id")).rows;
    const byGroup = {};
    for (const s of spares) (byGroup[s.group_id] ||= []).push(s);
    res.render("admin/spares", { groups, byGroup, total: spares.length });
  } catch (e) { next(e); }
});
router.get("/spares/new", async (req, res, next) => {
  try {
    const groups = (await db.query("SELECT * FROM spare_groups ORDER BY sort_order, id")).rows;
    res.render("admin/spare-form", {
      s: null, groups, images: listImages(), presetGroup: req.query.group || null,
    });
  } catch (e) { next(e); }
});
router.get("/spares/:id/edit", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM spares WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/spares");
    const groups = (await db.query("SELECT * FROM spare_groups ORDER BY sort_order, id")).rows;
    res.render("admin/spare-form", { s: r.rows[0], groups, images: listImages(), presetGroup: null });
  } catch (e) { next(e); }
});
router.post("/spares/:id/delete", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM spares WHERE id=$1 RETURNING name", [req.params.id]);
    flash(req, r.rows.length ? `Spare “${r.rows[0].name}” deleted.` : "Spare deleted.");
    res.redirect("/admin/spares");
  } catch (e) { next(e); }
});
router.post("/spares/:id?", upload.single("image_file"), async (req, res, next) => {
  try {
    const b = req.body;
    const vals = [b.group_id || null, b.name, b.description || null, pickImage(req), intOr0(b.sort_order)];
    if (req.params.id) {
      await db.query(
        "UPDATE spares SET group_id=$1, name=$2, description=$3, image=$4, sort_order=$5 WHERE id=$6",
        [...vals, req.params.id]);
      flash(req, `Spare “${b.name}” saved.`);
    } else {
      await db.query(
        "INSERT INTO spares (group_id, name, description, image, sort_order) VALUES ($1,$2,$3,$4,$5)", vals);
      flash(req, `Spare “${b.name}” created.`);
    }
    res.redirect("/admin/spares");
  } catch (e) { next(e); }
});

// ---------- locations ----------
router.get("/locations", async (req, res, next) => {
  try {
    const locations = (await db.query("SELECT * FROM locations ORDER BY sort_order, id")).rows;
    res.render("admin/locations", { locations });
  } catch (e) { next(e); }
});
router.get("/locations/new", (req, res) => res.render("admin/location-form", { l: null }));
router.get("/locations/:id/edit", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM locations WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/locations");
    res.render("admin/location-form", { l: r.rows[0] });
  } catch (e) { next(e); }
});
router.post("/locations/:id/delete", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM locations WHERE id=$1 RETURNING title", [req.params.id]);
    flash(req, r.rows.length ? `Location “${r.rows[0].title}” deleted.` : "Location deleted.");
    res.redirect("/admin/locations");
  } catch (e) { next(e); }
});
router.post("/locations/:id?", async (req, res, next) => {
  try {
    const b = req.body;
    const vals = [b.title, b.address || null, JSON.stringify(linesToPhones(b.phones)), b.map_url || null, intOr0(b.sort_order)];
    if (req.params.id) {
      await db.query(
        "UPDATE locations SET title=$1, address=$2, phones=$3, map_url=$4, sort_order=$5 WHERE id=$6",
        [...vals, req.params.id]);
      flash(req, `Location “${b.title}” saved.`);
    } else {
      await db.query(
        "INSERT INTO locations (title, address, phones, map_url, sort_order) VALUES ($1,$2,$3,$4,$5)", vals);
      flash(req, `Location “${b.title}” created.`);
    }
    res.redirect("/admin/locations");
  } catch (e) { next(e); }
});

// ---------- regional contacts ----------
router.get("/regions", async (req, res, next) => {
  try {
    const regions = (await db.query("SELECT * FROM regional_contacts ORDER BY sort_order, id")).rows;
    res.render("admin/regions", { regions });
  } catch (e) { next(e); }
});
router.get("/regions/new", (req, res) => res.render("admin/region-form", { r: null }));
router.get("/regions/:id/edit", async (req, res, next) => {
  try {
    const q = await db.query("SELECT * FROM regional_contacts WHERE id=$1", [req.params.id]);
    if (!q.rows.length) return res.redirect("/admin/regions");
    res.render("admin/region-form", { r: q.rows[0] });
  } catch (e) { next(e); }
});
router.post("/regions/:id/delete", async (req, res, next) => {
  try {
    const q = await db.query("DELETE FROM regional_contacts WHERE id=$1 RETURNING region", [req.params.id]);
    flash(req, q.rows.length ? `“${q.rows[0].region}” removed from the contact table.` : "Region deleted.");
    res.redirect("/admin/regions");
  } catch (e) { next(e); }
});
router.post("/regions/:id?", async (req, res, next) => {
  try {
    const vals = [req.body.region, req.body.phone, intOr0(req.body.sort_order)];
    if (req.params.id) {
      await db.query("UPDATE regional_contacts SET region=$1, phone=$2, sort_order=$3 WHERE id=$4", [...vals, req.params.id]);
      flash(req, `“${req.body.region}” saved.`);
    } else {
      await db.query("INSERT INTO regional_contacts (region, phone, sort_order) VALUES ($1,$2,$3)", vals);
      flash(req, `“${req.body.region}” added.`);
    }
    res.redirect("/admin/regions");
  } catch (e) { next(e); }
});

module.exports = router;
