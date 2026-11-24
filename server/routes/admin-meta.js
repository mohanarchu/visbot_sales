// Admin screen for the Meta Lead Ads integration: credentials, connection test,
// manual sync, CSV import and the delivery log.
const router = require("express").Router();
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const meta = require("../meta");
const { flash } = require("../admin-util");

// CSV exports are read in memory and never written to disk.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

async function page(req, res, extra) {
  const cfg = await meta.getConfig();

  // Give the user a verify token to paste into Meta on first visit.
  if (!cfg.meta_verify_token) {
    cfg.meta_verify_token = "visbot-" + crypto.randomBytes(8).toString("hex");
    await meta.setConfig({ meta_verify_token: cfg.meta_verify_token });
  }

  const stats = (await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE created_at >= current_date - interval '7 days')::int AS week
     FROM leads WHERE meta_leadgen_id IS NOT NULL`
  )).rows[0];

  const campaigns = (await db.query(
    `SELECT meta_campaign_name AS name, count(*)::int AS n
     FROM leads WHERE meta_campaign_name IS NOT NULL AND meta_campaign_name <> ''
     GROUP BY 1 ORDER BY n DESC LIMIT 8`
  )).rows;

  const logs = (await db.query(
    "SELECT * FROM integration_log WHERE channel='meta' ORDER BY created_at DESC, id DESC LIMIT 20"
  )).rows;

  // The webhook is served by the backend app, which is a different host from
  // the admin panel in production — so it must come from configuration, not
  // from the host the admin happens to be viewed on.
  const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0];
  const base = (process.env.BACKEND_PUBLIC_URL || "").replace(/\/$/, "")
    || proto + "://" + req.get("host");

  res.render("admin/meta", Object.assign({
    cfg, stats, campaigns, logs,
    webhookUrl: base + "/api/meta/webhook",
    isLocal: /localhost|127\.0\.0\.1|\[::1\]/i.test(base),
    result: null,
  }, extra || {}));
}

router.get("/", (req, res, next) => page(req, res).catch(next));

// ---------- save credentials ----------
router.post("/config", async (req, res, next) => {
  try {
    const b = req.body;
    const values = {
      meta_app_id: b.meta_app_id,
      meta_page_id: b.meta_page_id,
      meta_form_ids: b.meta_form_ids,
      meta_api_version: b.meta_api_version || meta.DEFAULT_API_VERSION,
      meta_verify_token: b.meta_verify_token,
    };
    // Secrets are only overwritten when a new value is actually typed in,
    // so saving the form with the masked placeholder keeps the stored one.
    if (b.meta_app_secret && !b.meta_app_secret.startsWith("••")) values.meta_app_secret = b.meta_app_secret;
    if (b.meta_page_token && !b.meta_page_token.startsWith("••")) values.meta_page_token = b.meta_page_token;

    await meta.setConfig(values);
    await meta.log("config", "ok", "Integration settings updated.");
    flash(req, "Meta settings saved.");
    res.redirect("/admin/integrations/meta");
  } catch (e) { next(e); }
});

router.post("/regenerate-token", async (req, res, next) => {
  try {
    const token = "visbot-" + crypto.randomBytes(8).toString("hex");
    await meta.setConfig({ meta_verify_token: token });
    flash(req, "New verify token generated — paste it into Meta again.");
    res.redirect("/admin/integrations/meta");
  } catch (e) { next(e); }
});

// ---------- connection test ----------
router.post("/test", async (req, res, next) => {
  try {
    const cfg = await meta.getConfig();
    const out = await meta.testConnection(cfg);
    const formLines = out.forms.map((f) =>
      `${f.name || "(unnamed form)"} — id ${f.id}${f.leads_count !== undefined ? `, ${f.leads_count} leads` : ""}`);
    await meta.log("test", "ok", `Connected to Page “${out.page.name}”, ${out.forms.length} form(s) visible.`);
    return page(req, res, {
      result: {
        ok: true,
        title: `Connected to “${out.page.name}”`,
        lines: formLines.length ? ["Lead forms on this Page:"].concat(formLines)
          : [out.formsError ? "Could not list lead forms: " + out.formsError
                            : "No lead forms found on this Page yet."],
      },
    });
  } catch (e) {
    await meta.log("test", "error", e.message);
    return page(req, res, {
      result: { ok: false, title: "Could not connect to Meta", lines: [e.message] },
    }).catch(next);
  }
});

// ---------- manual sync ----------
router.post("/sync", async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.body.days, 10) || 30));
    const cfg = await meta.getConfig();
    const r = await meta.syncLeads(cfg, days);
    flash(req, r.created
      ? `Imported ${r.created} new lead${r.created === 1 ? "" : "s"} from Meta (${r.skipped} already present).`
      : `No new leads — ${r.skipped} already in the system.`);
    res.redirect("/admin/leads?source=");
  } catch (e) {
    await meta.log("sync", "error", e.message);
    flash(req, "Sync failed: " + e.message, "err");
    res.redirect("/admin/integrations/meta");
  }
});

// ---------- CSV import ----------
router.post("/import", csvUpload.single("csv"), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      flash(req, "Choose a CSV file exported from Meta first.", "err");
      return res.redirect("/admin/integrations/meta");
    }
    let text = req.file.buffer.toString("utf8");
    // Meta sometimes exports UTF-16 with a BOM; decode it properly.
    const b = req.file.buffer;
    if (b.length > 1 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) {
      text = b.toString(b[0] === 0xff ? "utf16le" : "utf16le");
    }
    const r = await meta.importCsv(text);
    flash(req, `Import finished: ${r.created} new, ${r.skipped} already present` +
      (r.failed ? `, ${r.failed} row(s) skipped` : "") + ".");
    res.redirect(r.created ? "/admin/leads" : "/admin/integrations/meta");
  } catch (e) {
    await meta.log("csv", "error", e.message);
    flash(req, "Import failed: " + e.message, "err");
    res.redirect("/admin/integrations/meta");
  }
});

module.exports = router;
