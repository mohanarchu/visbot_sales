// Lead management: pipeline list, lead detail with activity log, manual entry, CSV export.
// Mounted at /admin/leads — authentication and flash handling happen in routes/admin.js.
const router = require("express").Router();
const db = require("../db");
const { flash, trim } = require("../admin-util");
const M = require("../leads-meta");
const ST = require("../states");

const PER_PAGE = 25;

// ---------- list ----------
router.get("/", async (req, res, next) => {
  try {
    const f = {
      status: M.isStatus(req.query.status) ? req.query.status : "",
      source: M.isSource(req.query.source) ? req.query.source : "",
      priority: M.isPriority(req.query.priority) ? req.query.priority : "",
      q: (req.query.q || "").trim(),
      due: req.query.due === "1",
      open: req.query.open === "1",
    };

    const where = [];
    const params = [];
    if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
    if (f.source) { params.push(f.source); where.push(`source = $${params.length}`); }
    if (f.priority) { params.push(f.priority); where.push(`priority = $${params.length}`); }
    if (f.q) {
      params.push("%" + f.q + "%");
      const i = params.length;
      where.push(`(name ILIKE $${i} OR phone ILIKE $${i} OR email ILIKE $${i}
                   OR company ILIKE $${i} OR interest ILIKE $${i} OR state ILIKE $${i}
                   OR city ILIKE $${i} OR message ILIKE $${i})`);
    }
    if (f.due) where.push(`next_followup IS NOT NULL AND next_followup <= current_date AND status NOT IN ('won','lost')`);
    if (f.open) where.push(`status NOT IN ('won','lost')`);

    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = parseInt((await db.query(`SELECT count(*) FROM leads ${clause}`, params)).rows[0].count, 10);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const offset = (Math.min(page, pages) - 1) * PER_PAGE;

    const leads = (await db.query(
      `SELECT l.*, (SELECT count(*) FROM lead_notes n WHERE n.lead_id = l.id)::int AS note_count
       FROM leads l ${clause}
       ORDER BY
         CASE WHEN l.status = 'new' THEN 0 ELSE 1 END,
         CASE l.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         l.created_at DESC
       LIMIT ${PER_PAGE} OFFSET ${offset}`, params)).rows;

    const tabCounts = (await db.query(
      `SELECT status, count(*)::int AS n FROM leads GROUP BY status`
    )).rows.reduce((a, r) => (a[r.status] = r.n, a), {});
    const allCount = Object.values(tabCounts).reduce((a, b) => a + b, 0);

    res.render("admin/leads", {
      leads, f, total, page: Math.min(page, pages), pages, tabCounts, allCount,
    });
  } catch (e) { next(e); }
});

// ---------- CSV export (declared before /:id) ----------
router.get("/export.csv", async (req, res, next) => {
  try {
    const rows = (await db.query(
      `SELECT created_at, name, phone, email, company, city, state, interest,
              source, status, priority, owner, next_followup, message
       FROM leads ORDER BY created_at DESC`)).rows;

    // Dates are formatted from local parts — toISOString() would shift a
    // local-midnight DATE back to the previous day in IST.
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => {
      if (!d) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // DATE columns arrive as plain strings
      const t = new Date(d);
      return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    };
    const ymdhm = (d) => (d ? ymd(d) + " " + pad(new Date(d).getHours()) + ":" + pad(new Date(d).getMinutes()) : "");

    // Neutralise spreadsheet formula injection, then quote every field.
    const cell = (v) => {
      let s = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const header = ["Created", "Name", "Phone", "Email", "Company", "City", "State",
      "Interest", "Source", "Status", "Priority", "Owner", "Next follow-up", "Message"];
    const csv = [header.map(cell).join(",")].concat(
      rows.map((r) => [
        ymdhm(r.created_at), r.name, r.phone, r.email, r.company, r.city, r.state,
        r.interest, r.source, r.status, r.priority, r.owner, ymd(r.next_followup), r.message,
      ].map(cell).join(","))
    ).join("\r\n");

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="visbot-leads-${stamp}.csv"`);
    res.send("﻿" + csv);
  } catch (e) { next(e); }
});

// ---------- new / edit forms ----------
router.get("/new", async (req, res, next) => {
  try {
    const products = (await db.query("SELECT name FROM products ORDER BY name")).rows;
    res.render("admin/lead-form", { l: null, products, states: await ST.list() });
  } catch (e) { next(e); }
});

router.get("/:id/edit", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM leads WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/leads");
    const products = (await db.query("SELECT name FROM products ORDER BY name")).rows;
    res.render("admin/lead-form", { l: r.rows[0], products, states: await ST.list() });
  } catch (e) { next(e); }
});

// ---------- detail ----------
router.get("/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM leads WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return next();
    const notes = (await db.query(
      "SELECT * FROM lead_notes WHERE lead_id=$1 ORDER BY created_at DESC, id DESC", [req.params.id]
    )).rows;
    res.render("admin/lead-detail", { l: r.rows[0], notes });
  } catch (e) { next(e); }
});

// ---------- create / update ----------
function leadFields(b) {
  return [
    (b.name || "").trim(),
    trim(b.phone), trim(b.email), trim(b.company), trim(b.city), trim(b.state),
    trim(b.interest), trim(b.message),
    M.isSource(b.source) ? b.source : "other",
    M.isStatus(b.status) ? b.status : "new",
    M.isPriority(b.priority) ? b.priority : "medium",
    trim(b.owner),
    trim(b.next_followup),
  ];
}

router.post("/:id/status", async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!M.isStatus(status)) {
      flash(req, "Unknown status.", "err");
      return res.redirect("/admin/leads/" + req.params.id);
    }
    const r = await db.query(
      "UPDATE leads SET status=$1, updated_at=now() WHERE id=$2 RETURNING name", [status, req.params.id]);
    if (!r.rows.length) return res.redirect("/admin/leads");
    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,'status')",
      [req.params.id, "Status changed to " + M.statusMeta(status).label + "."]);
    flash(req, `${r.rows[0].name} moved to ${M.statusMeta(status).label}.`);
    res.redirect("/admin/leads/" + req.params.id);
  } catch (e) { next(e); }
});

router.post("/:id/notes", async (req, res, next) => {
  try {
    const note = (req.body.note || "").trim();
    const followup = trim(req.body.next_followup);
    if (!note && !followup) {
      flash(req, "Nothing to log — add a note or a follow-up date.", "err");
      return res.redirect("/admin/leads/" + req.params.id);
    }
    if (note) {
      await db.query("INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,$3)",
        [req.params.id, note, req.body.kind === "call" ? "call" : "note"]);
    }
    if (followup) {
      await db.query("UPDATE leads SET next_followup=$1, updated_at=now() WHERE id=$2",
        [followup, req.params.id]);
      await db.query("INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,'followup')",
        [req.params.id, "Follow-up set for " + followup + "."]);
    }
    flash(req, "Activity logged.");
    res.redirect("/admin/leads/" + req.params.id);
  } catch (e) { next(e); }
});

router.post("/:id/delete", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM leads WHERE id=$1 RETURNING name", [req.params.id]);
    flash(req, r.rows.length ? `Lead “${r.rows[0].name}” deleted.` : "Lead deleted.");
    res.redirect("/admin/leads");
  } catch (e) { next(e); }
});

router.post("/:id?", async (req, res, next) => {
  try {
    const vals = leadFields(req.body);
    if (!vals[0]) {
      flash(req, "A lead needs at least a name.", "err");
      return res.redirect(req.params.id ? `/admin/leads/${req.params.id}/edit` : "/admin/leads/new");
    }
    if (req.params.id) {
      await db.query(
        `UPDATE leads SET name=$1, phone=$2, email=$3, company=$4, city=$5, state=$6,
         interest=$7, message=$8, source=$9, status=$10, priority=$11, owner=$12,
         next_followup=$13, updated_at=now() WHERE id=$14`, [...vals, req.params.id]);
      flash(req, `Lead “${vals[0]}” saved.`);
      return res.redirect("/admin/leads/" + req.params.id);
    }
    const ins = await db.query(
      `INSERT INTO leads (name, phone, email, company, city, state, interest, message,
       source, status, priority, owner, next_followup)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, vals);
    await db.query("INSERT INTO lead_notes (lead_id, note, kind) VALUES ($1,$2,'created')",
      [ins.rows[0].id, "Lead added manually in the admin panel."]);
    flash(req, `Lead “${vals[0]}” created.`);
    res.redirect("/admin/leads/" + ins.rows[0].id);
  } catch (e) { next(e); }
});

module.exports = router;
