// Admin shell: authentication, flash messages, the lead dashboard, and the sub-routers.
const router = require("express").Router();
const db = require("../db");
const M = require("../leads-meta");
const U = require("../users");

// ---------- login throttling ----------
// The panel is reachable from the internet, so failed attempts are counted per
// IP and the form locks for a while after too many.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> timestamps of failures

function failures(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length) attempts.set(ip, recent); else attempts.delete(ip);
  return recent;
}
function recordFailure(ip) {
  const recent = failures(ip);
  recent.push(Date.now());
  attempts.set(ip, recent);
  if (attempts.size > 1000) attempts.clear();
}
function lockedFor(ip) {
  const recent = failures(ip);
  if (recent.length < MAX_ATTEMPTS) return 0;
  return Math.ceil((WINDOW_MS - (Date.now() - recent[0])) / 60000);
}

// ---------- auth ----------
// Password comparison itself lives in ../users, so both panels and the mobile
// API check credentials the same way.
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) {
    res.locals.user = req.session.user || null;
    return next();
  }
  res.redirect("/admin/login");
}

router.get("/login", (req, res) => {
  if (req.session.authed) return res.redirect("/admin");
  res.render("admin/login", { error: null });
});

router.post("/login", async (req, res, next) => {
  const mins = lockedFor(req.ip);
  if (mins > 0) {
    return res.status(429).render("admin/login", {
      error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    });
  }

  try {
    // The form's field is still called `username`; what people type into it is
    // a mobile number or an email address.
    const { username, password } = req.body;

    // Same two doors as the single-page panel: the .env administrator, then the
    // users table. Both panels share this session cookie.
    let user = null;
    if (U.verifyEnvAdmin(username, password)) {
      user = U.ENV_ADMIN();
    } else {
      const row = await U.findByLogin(username);
      if (row && await U.verifyPassword(password, row.password_hash)) user = row;
    }

    if (user && user.active === false) {
      return res.status(403).render("admin/login", {
        error: "That account has been switched off. Ask an administrator to turn it back on.",
      });
    }
    if (user && !U.can(user.role, "web")) {
      return res.status(403).render("admin/login", {
        error: "This account is for the Visbot Sales mobile app, not the web panel.",
      });
    }

    if (user) {
      attempts.delete(req.ip);
      await U.touchLogin(user.id);
      const safe = {
        id: user.id, name: user.name, role: user.role,
        email: user.email || null, phone: user.phone || null,
        login_id: user.env ? U.envAdminName() : U.loginId(user),
        env: !!user.env, must_change_password: !!user.must_change_password,
      };
      return req.session.regenerate((err) => {
        if (err) return res.render("admin/login", { error: "Could not start a session. Try again." });
        req.session.authed = true;
        req.session.user = safe;
        res.redirect("/admin");
      });
    }

    recordFailure(req.ip);
    const left = MAX_ATTEMPTS - failures(req.ip).length;
    res.status(401).render("admin/login", {
      error: "Wrong mobile number, email address or password."
        + (left <= 3 && left > 0 ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""),
    });
  } catch (e) { next(e); }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

router.use(requireAuth);

// Hand any pending flash message to the next rendered page, then clear it.
router.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// ---------- lead dashboard (the admin home) ----------
router.get("/", async (req, res, next) => {
  try {
    const stats = (await db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'new')::int AS new_count,
         count(*) FILTER (WHERE status NOT IN ('won','lost'))::int AS open_count,
         count(*) FILTER (WHERE created_at >= current_date - interval '7 days')::int AS week_count,
         count(*) FILTER (WHERE created_at >= date_trunc('month', current_date))::int AS month_count,
         count(*) FILTER (WHERE status = 'won')::int AS won_count,
         count(*) FILTER (WHERE status = 'lost')::int AS lost_count,
         count(*) FILTER (WHERE next_followup IS NOT NULL
                            AND next_followup <= current_date
                            AND status NOT IN ('won','lost'))::int AS due_count
       FROM leads`
    )).rows[0];

    const byStatus = (await db.query(
      "SELECT status, count(*)::int AS n FROM leads GROUP BY status"
    )).rows.reduce((a, r) => (a[r.status] = r.n, a), {});

    const bySource = (await db.query(
      `SELECT source, count(*)::int AS n FROM leads GROUP BY source ORDER BY n DESC, source`
    )).rows;

    const topInterest = (await db.query(
      `SELECT interest, count(*)::int AS n FROM leads
       WHERE interest IS NOT NULL AND interest <> ''
       GROUP BY interest ORDER BY n DESC, interest LIMIT 6`
    )).rows;

    const recent = (await db.query(
      "SELECT * FROM leads ORDER BY created_at DESC LIMIT 8"
    )).rows;

    const dueSoon = (await db.query(
      `SELECT * FROM leads
       WHERE next_followup IS NOT NULL AND status NOT IN ('won','lost')
         AND next_followup <= current_date + interval '3 days'
       ORDER BY next_followup LIMIT 10`
    )).rows;

    res.render("admin/dashboard", { stats, byStatus, bySource, topInterest, recent, dueSoon });
  } catch (e) { next(e); }
});

// ---------- sub-routers ----------
router.use("/leads", require("./admin-leads"));
router.use("/integrations/meta", require("./admin-meta"));
router.use("/", require("./admin-content"));

module.exports = router;
