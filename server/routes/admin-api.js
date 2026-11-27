// JSON API behind the admin single-page app. Mounted at /api/admin on the admin
// host, so the session cookie is same-origin and stays httpOnly.
const router = require("express").Router();
const crypto = require("crypto");
const db = require("../db");
const M = require("../leads-meta");
const U = require("../users");
const ST = require("../states");
const meta = require("../meta");
const F = require("../format");
const { pageOf, countOf } = require("../paging");
const R = require("../referrals");
const {
  upload, listImages, linesToFeatures, linesToSpecs, linesToPhones,
  pickImage, intOr0, trim,
} = require("../admin-util");

const ok = (res, data, extra) => res.json(Object.assign({ data }, extra || {}));
const fail = (res, code, message) => res.status(code).json({ error: { message } });

// ---------- login throttling ----------
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function failures(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length) attempts.set(ip, recent); else attempts.delete(ip);
  return recent;
}
function lockedMinutes(ip) {
  const recent = failures(ip);
  if (recent.length < MAX_ATTEMPTS) return 0;
  return Math.ceil((WINDOW_MS - (Date.now() - recent[0])) / 60000);
}
function recordFailure(ip) {
  const recent = failures(ip);
  recent.push(Date.now());
  attempts.set(ip, recent);
  if (attempts.size > 1000) attempts.clear();
  return MAX_ATTEMPTS - recent.length;
}

const wrongPassword = (res, left) => fail(res, 401,
  "Wrong username or password." +
  (left <= 3 && left > 0 ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""));

// ---------- session ----------
const sessionUser = (req) =>
  (req.session && req.session.authed && req.session.user) ? req.session.user : null;

router.get("/session", (req, res) => {
  const u = sessionUser(req);
  ok(res, {
    authed: !!u,
    // The panel reads `user.can` to decide what to put in the menu; the server
    // still checks every request for itself.
    user: u ? U.publicUser(u) : null,
  });
});

router.post("/login", async (req, res, next) => {
  try {
    const mins = lockedMinutes(req.ip);
    if (mins > 0) {
      return fail(res, 429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
    }
    // A mobile number or an email address; `username` is still read so an old
    // cached copy of the panel keeps working.
    const body = req.body || {};
    const identifier = body.identifier === undefined ? body.username : body.identifier;
    const password = body.password;

    // The .env administrator first: it must keep working even if the users table
    // is empty or unreachable.
    let user = null;
    if (U.verifyEnvAdmin(identifier, password)) {
      user = U.ENV_ADMIN();
    } else {
      const row = await U.findByLogin(identifier);
      if (row && await U.verifyPassword(password, row.password_hash)) user = row;
    }

    if (!user) return wrongPassword(res, recordFailure(req.ip));
    if (user.active === false) {
      return fail(res, 403, "That account has been switched off. Ask an administrator to turn it back on.");
    }
    if (!U.can(user.role, "web")) {
      return fail(res, 403, "This account is for the Visbot Sales mobile app, not the web panel.");
    }

    attempts.delete(req.ip);
    await U.touchLogin(user.id);
    const safe = {
      id: user.id, name: user.name, role: user.role,
      email: user.email || null, phone: user.phone || null,
      login_id: user.env ? U.envAdminName() : U.loginId(user),
      env: !!user.env, must_change_password: !!user.must_change_password,
    };
    req.session.regenerate((err) => {
      if (err) return fail(res, 500, "Could not start a session.");
      req.session.authed = true;
      req.session.user = safe;
      ok(res, { authed: true, user: U.publicUser(safe) });
    });
  } catch (e) { next(e); }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => ok(res, { authed: false }));
});

// ---------- guards ----------
router.use((req, res, next) => {
  const u = sessionUser(req);
  if (!u) return fail(res, 401, "Not signed in.");
  req.user = u;
  next();
});

// Only an administrator manages users. Everything else in this API is open to
// both admin and manager; sales accounts never reach the web panel at all.
const requireArea = (area) => (req, res, next) => {
  if (U.can(req.user.role, area)) return next();
  fail(res, 403, "Your account does not have access to that.");
};

// Session cookies are SameSite=lax and this API sends no CORS headers, so a
// cross-site page cannot read responses. Requiring a header that a plain HTML
// form cannot set closes the remaining CSRF gap on state changes.
router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.get("x-requested-with") === "visbot-admin") return next();
  fail(res, 403, "Missing X-Requested-With header.");
});

// ---------- reference data the UI needs ----------
router.get("/vocab", (req, res) => {
  ok(res, {
    statuses: M.STATUSES,
    sources: M.SOURCES,
    priorities: M.PRIORITIES,
    open_statuses: M.OPEN_STATUSES,
    roles: U.ROLES,
  });
});

router.get("/images", (req, res) => ok(res, listImages()));

// Every state and union territory, with how many leads and how many people sit
// in each. Feeds the lead filter and the states a user covers.
router.get("/states", async (req, res, next) => {
  try {
    ok(res, await ST.listWithCounts());
  } catch (e) { next(e); }
});

// ---------- the signed-in account ----------
router.get("/me", async (req, res, next) => {
  try {
    // Read the row back, so a role change made by someone else shows up on the
    // next page load rather than at the next sign-in.
    const fresh = req.user.id ? await U.findById(req.user.id) : req.user;
    if (!fresh) return fail(res, 401, "That account no longer exists.");
    ok(res, Object.assign(U.publicUser(Object.assign({ env: req.user.env }, fresh)),
      { states: await ST.forUser(req.user.id) }));
  } catch (e) { next(e); }
});

router.post("/me/password", async (req, res, next) => {
  try {
    if (!req.user.id) {
      return fail(res, 400, "The built-in administrator's password is set in the server's .env file, not here.");
    }
    const { current_password, password } = req.body || {};
    const hash = await U.hashFor(req.user.id);
    if (!hash || !await U.verifyPassword(current_password, hash)) {
      return fail(res, 400, "That is not your current password.");
    }
    const problem = U.passwordProblem(password);
    if (problem) return fail(res, 400, problem);
    await U.setPassword(req.user.id, password);
    // setPassword clears every app token, and this session is the one changing
    // the password, so keep it signed in but drop the nag.
    req.session.user = Object.assign({}, req.session.user, { must_change_password: false });
    ok(res, { saved: true }, { message: "Your password has been changed." });
  } catch (e) { next(e); }
});

// ---------- users (administrators only) ----------
// Everyone who can be given a lead — needed by the lead form, so it is not
// behind the user-management guard.
router.get("/users/assignable", async (req, res, next) => {
  try {
    const team = await U.assignable();
    const byUser = await ST.forUsers(team.map((u) => u.id));
    ok(res, team.map((u) => ({
      id: u.id, name: u.name, role: u.role, role_label: U.roleLabel(u.role),
      states: byUser[u.id] || [],
    })));
  } catch (e) { next(e); }
});

router.use("/referrers", require("./admin-referrers"));

router.use("/users", requireArea("users"));

router.get("/users", async (req, res, next) => {
  try {
    const rows = await U.list({
      q: (req.query.q || "").trim(),
      role: U.isRole(req.query.role) ? req.query.role : "",
      active: req.query.active === "1" || req.query.active === "0" ? req.query.active : "",
    });
    const counts = rows.reduce((a, u) => {
      if (u.active) a[u.role] = (a[u.role] || 0) + 1;
      return a;
    }, {});
    const p = pageOf(req, rows.length);
    const shown = p.all ? rows : rows.slice(p.offset, p.offset + p.per);
    // One query for everybody's states, rather than one per person.
    const byUser = await ST.forUsers(shown.map((u) => u.id));
    ok(res, shown.map((u) => Object.assign(U.publicUser(u), { states: byUser[u.id] || [] })), {
      meta: p.meta,
      role_counts: counts,
      env_admin: U.envAdminName(),
    });
  } catch (e) { next(e); }
});

router.get("/users/:id(\\d+)", async (req, res, next) => {
  try {
    const u = await U.findById(req.params.id);
    if (!u) return fail(res, 404, "User not found.");
    ok(res, Object.assign(U.publicUser(u), { states: await ST.forUser(u.id) }));
  } catch (e) { next(e); }
});

function userFields(b) {
  return {
    name: (b.name || "").trim(),
    email: trim(b.email),
    phone: trim(b.phone),
    role: U.isRole(b.role) ? b.role : "sales",
    active: b.active !== false && b.active !== "false" && b.active !== "",
  };
}

// A number or an address belongs to one person. Report the clash in words
// rather than letting a constraint violation surface as a server error.
function duplicate(res, e) {
  if (e.code !== "23505") return false;
  const which = /phone/.test(e.constraint || "") ? "mobile number" : "email address";
  fail(res, 400, `Somebody already signs in with that ${which}.`);
  return true;
}

router.post("/users", async (req, res, next) => {
  try {
    const f = userFields(req.body);
    if (!f.name) return fail(res, 400, "A user needs a name.");
    const bad = U.contactProblem(f) || U.passwordProblem(req.body.password);
    if (bad) return fail(res, 400, bad);

    const u = await U.create(Object.assign({}, f, {
      password: req.body.password,
      must_change_password: req.body.must_change_password !== false,
    }));
    // Which states they cover. A sales person sees the leads in them.
    const states = await ST.setForUser(u.id, req.body.state_ids);
    ok(res, Object.assign(U.publicUser(u), { states: await ST.forUser(u.id) }), {
      message: `${u.name} can now sign in with ${U.loginId(u)}.`
        + (states.length ? ` Covering ${states.length} state${states.length === 1 ? "" : "s"}.` : ""),
    });
  } catch (e) { if (!duplicate(res, e)) next(e); }
});

router.put("/users/:id(\\d+)", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await U.findById(id);
    if (!existing) return fail(res, 404, "User not found.");

    const f = userFields(req.body);
    if (!f.name) return fail(res, 400, "A user needs a name.");
    const bad = U.contactProblem(f);
    if (bad) return fail(res, 400, bad);

    // A password is only changed when one was typed; an empty box leaves the
    // password they already have alone.
    const newPassword = String(req.body.password == null ? "" : req.body.password);
    if (newPassword) {
      const pwBad = U.passwordProblem(newPassword);
      if (pwBad) return fail(res, 400, pwBad);
    }

    // Nobody may lock themselves out, and the panel must keep one administrator
    // who can still create users.
    const self = req.user.id === id;
    if (self && f.role !== "admin") return fail(res, 400, "You cannot change your own role.");
    if (self && !f.active) return fail(res, 400, "You cannot switch off your own account.");
    if (existing.role === "admin" && existing.active
        && (f.role !== "admin" || !f.active) && await U.countAdmins(id) === 0) {
      return fail(res, 400, "This is the only administrator left. Make someone else an administrator first.");
    }

    let u = await U.update(id, f);
    // Left out of the request, the states they cover are untouched.
    if (req.body.state_ids !== undefined) {
      await ST.setForUser(id, req.body.state_ids);
    }
    if (newPassword) {
      // Whoever is given a password by somebody else is asked to change it.
      u = (await U.setPassword(id, newPassword, { mustChange: !self })) || u;
    }
    if (!f.active) await U.revokeAllForUser(id);
    ok(res, Object.assign(U.publicUser(u), { states: await ST.forUser(id) }), {
      message: newPassword
        ? `${u.name} saved, with a new password. The sales app on their phone has been signed out.`
        : `${u.name} saved.`,
    });
  } catch (e) { if (!duplicate(res, e)) next(e); }
});

router.delete("/users/:id(\\d+)", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await U.findById(id);
    if (!existing) return fail(res, 404, "User not found.");
    if (req.user.id === id) return fail(res, 400, "You cannot delete your own account.");
    if (existing.role === "admin" && existing.active && await U.countAdmins(id) === 0) {
      return fail(res, 400, "This is the only administrator left. Make someone else an administrator first.");
    }
    // Leads and reviews keep their history: the schema sets the link to NULL
    // rather than removing anything the user touched.
    await U.remove(id);
    ok(res, { deleted: true }, { message: `${existing.name} has been removed.` });
  } catch (e) { next(e); }
});

router.all("/users/:id", (req, res) => fail(res, 404, "User not found."));

// ---------- when a lead arrived ----------
// Dates throughout are the business's own day, not the server's. The server
// runs on UTC, which is 5.5 hours behind: without this, every lead between
// midnight and 5.30am would be filed under the previous day.
const TZ = "Asia/Kolkata";
const LOCAL_DATE = `(l.created_at AT TIME ZONE '${TZ}')::date`;
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;

const PERIODS = ["today", "yesterday", "7d", "30d", "month", "custom"];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

function periodClause(f, params) {
  // Explicit dates win: the dropdown is a shortcut, not a restriction.
  if (f.from || f.to) {
    const bits = [];
    if (f.from) { params.push(f.from); bits.push(`${LOCAL_DATE} >= $${params.length}::date`); }
    if (f.to) { params.push(f.to); bits.push(`${LOCAL_DATE} <= $${params.length}::date`); }
    return bits.join(" AND ");
  }
  switch (f.period) {
    case "today":     return `${LOCAL_DATE} = ${TODAY}`;
    case "yesterday": return `${LOCAL_DATE} = ${TODAY} - 1`;
    case "7d":        return `${LOCAL_DATE} > ${TODAY} - 7`;
    case "30d":       return `${LOCAL_DATE} > ${TODAY} - 30`;
    case "month":     return `date_trunc('month', ${LOCAL_DATE}) = date_trunc('month', ${TODAY})`;
    default:          return "";
  }
}

// ---------- lead dashboard ----------
router.get("/dashboard", async (req, res, next) => {
  try {
    const stats = (await db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'new')::int AS new_count,
         count(*) FILTER (WHERE status NOT IN ('won','lost'))::int AS open_count,
         count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date
                            = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_count,
         count(*) FILTER (WHERE created_at >= current_date - interval '7 days')::int AS week_count,
         count(*) FILTER (WHERE status = 'won')::int AS won_count,
         count(*) FILTER (WHERE status = 'lost')::int AS lost_count,
         count(*) FILTER (WHERE next_followup IS NOT NULL
                            AND next_followup <= current_date
                            AND status NOT IN ('won','lost'))::int AS due_count
       FROM leads`)).rows[0];

    const byStatus = (await db.query(
      "SELECT status, count(*)::int AS n FROM leads GROUP BY status")).rows
      .reduce((a, r) => (a[r.status] = r.n, a), {});

    const bySource = (await db.query(
      "SELECT source, count(*)::int AS n FROM leads GROUP BY source ORDER BY n DESC, source")).rows;

    const topInterest = (await db.query(
      `SELECT interest, count(*)::int AS n FROM leads
       WHERE interest IS NOT NULL AND interest <> ''
       GROUP BY interest ORDER BY n DESC, interest LIMIT 6`)).rows;

    const recent = (await db.query("SELECT * FROM leads ORDER BY created_at DESC LIMIT 8")).rows;

    const dueSoon = (await db.query(
      `SELECT * FROM leads
       WHERE next_followup IS NOT NULL AND status NOT IN ('won','lost')
         AND next_followup <= current_date + interval '3 days'
       ORDER BY next_followup LIMIT 10`)).rows;

    const service = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at >= current_date - interval '7 days')::int AS week_count
       FROM service_requests`)).rows[0];

    // Last 14 days, one row per day including the days nobody enquired —
    // a flat stretch is information, and a chart with the gaps closed up lies
    // about how busy a week was.
    const daily = (await db.query(
      `WITH days AS (
         SELECT generate_series(
           (now() AT TIME ZONE 'Asia/Kolkata')::date - 13,
           (now() AT TIME ZONE 'Asia/Kolkata')::date,
           interval '1 day')::date AS d)
       SELECT days.d AS day,
              count(l.id)::int AS n,
              count(l.id) FILTER (WHERE l.status = 'won')::int AS won
         FROM days
         LEFT JOIN leads l
           ON (l.created_at AT TIME ZONE 'Asia/Kolkata')::date = days.d
        GROUP BY days.d ORDER BY days.d`)).rows;

    const monthly = (await db.query(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date) - interval '5 months',
           date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date),
           interval '1 month')::date AS m)
       SELECT months.m AS month,
              count(l.id)::int AS n,
              count(l.id) FILTER (WHERE l.status = 'won')::int AS won
         FROM months
         LEFT JOIN leads l
           ON date_trunc('month', (l.created_at AT TIME ZONE 'Asia/Kolkata')::date) = months.m
        GROUP BY months.m ORDER BY months.m`)).rows;

    ok(res, { stats, byStatus, bySource, topInterest, recent, dueSoon, service, daily, monthly });
  } catch (e) { next(e); }
});

// ---------- leads ----------
router.get("/leads", async (req, res, next) => {
  try {
    const f = {
      status: M.isStatus(req.query.status) ? req.query.status : "",
      source: M.isSource(req.query.source) ? req.query.source : "",
      priority: M.isPriority(req.query.priority) ? req.query.priority : "",
      q: (req.query.q || "").trim(),
      state: req.query.state === "none" ? "none"
        : (/^\d+$/.test(req.query.state || "") ? req.query.state : ""),
      due: req.query.due === "1" || req.query.due === "true",
      open: req.query.open === "1" || req.query.open === "true",
      period: PERIODS.includes(req.query.period) ? req.query.period : "",
      from: isDate(req.query.from) ? req.query.from : "",
      to: isDate(req.query.to) ? req.query.to : "",
    };
    // Both queries below read FROM leads l, and the rows query also joins the
    // states table — which has a `name` of its own — so every column here is
    // qualified. An unqualified one would be ambiguous and fail the request.
    const where = [];
    const params = [];
    if (f.status) { params.push(f.status); where.push(`l.status = $${params.length}`); }
    if (f.source) { params.push(f.source); where.push(`l.source = $${params.length}`); }
    if (f.priority) { params.push(f.priority); where.push(`l.priority = $${params.length}`); }
    // By state, from the states master rather than the free text on the lead,
    // so "Tamilnadu" and "Tamil Nadu" are one filter. "none" finds the leads
    // whose state is missing, or not a state anybody recognises.
    if (f.state === "none") {
      where.push("l.state_id IS NULL");
    } else if (f.state) {
      params.push(f.state);
      where.push(`l.state_id = $${params.length}`);
    }
    if (f.q) {
      params.push("%" + f.q + "%");
      const i = params.length;
      where.push(`(l.name ILIKE $${i} OR l.phone ILIKE $${i} OR l.email ILIKE $${i}
                   OR l.company ILIKE $${i} OR l.interest ILIKE $${i} OR l.state ILIKE $${i}
                   OR l.city ILIKE $${i} OR l.message ILIKE $${i})`);
    }
    if (f.due) where.push("l.next_followup IS NOT NULL AND l.next_followup <= current_date AND l.status NOT IN ('won','lost')");
    if (f.open) where.push("l.status NOT IN ('won','lost')");

    // When the lead arrived. Dates are compared in Indian time, not the
    // server's: a lead that came in at 2am in Coimbatore is 8.30pm UTC the day
    // before, and "Today" has to mean today in Coimbatore.
    const dayClause = periodClause(f, params);
    if (dayClause) where.push(dayClause);

    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = parseInt((await db.query(
      `SELECT count(*) FROM leads l ${clause}`, params)).rows[0].count, 10);
    const p = pageOf(req, total);

    const rows = (await db.query(
      `SELECT l.*, s.name AS state_name, s.code AS state_code,
              rf.name AS referrer_name, rf.phone AS referrer_phone,
              (SELECT count(*) FROM lead_notes n WHERE n.lead_id = l.id)::int AS note_count
       FROM leads l
       LEFT JOIN states s ON s.id = l.state_id
       LEFT JOIN referrers rf ON rf.id = l.referrer_id ${clause}
       ORDER BY CASE WHEN l.status = 'new' THEN 0 ELSE 1 END,
                CASE l.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                l.created_at DESC
       ${p.sql}`, params)).rows;

    const tabCounts = (await db.query("SELECT status, count(*)::int AS n FROM leads GROUP BY status")).rows
      .reduce((a, r) => (a[r.status] = r.n, a), {});

    ok(res, rows, {
      meta: p.meta,
      tab_counts: tabCounts,
      all_count: Object.values(tabCounts).reduce((a, b) => a + b, 0),
    });
  } catch (e) { next(e); }
});

// Declared before /leads/:id so the filename is not read as an id. This is a
// plain link in the UI, so it must work as an ordinary browser navigation.
router.get("/leads/export.csv", async (req, res, next) => {
  try {
    const rows = (await db.query(
      `SELECT created_at, name, phone, email, company, city, state, interest,
              source, status, priority, owner, next_followup, message
       FROM leads ORDER BY created_at DESC`)).rows;

    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => {
      if (!d) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // DATE columns arrive as plain strings
      const t = new Date(d);
      return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    };
    const ymdhm = (d) => (d ? ymd(d) + " " + pad(new Date(d).getHours()) + ":" + pad(new Date(d).getMinutes()) : "");
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

router.get("/leads/:id", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT l.*, rf.name AS referrer_name, rf.phone AS referrer_phone,
              rf.active AS referrer_active
       FROM leads l LEFT JOIN referrers rf ON rf.id = l.referrer_id
       WHERE l.id = $1`, [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Lead not found.");
    const notes = (await db.query(
      "SELECT * FROM lead_notes WHERE lead_id=$1 ORDER BY created_at DESC, id DESC",
      [req.params.id])).rows;
    ok(res, { lead: r.rows[0], notes });
  } catch (e) { next(e); }
});

// A lead can be assigned to a user. The free-text `owner` column is kept in step
// with that user's name, so the older pages, the CSV export and anything reading
// the table directly keep working.
async function assignment(b) {
  const raw = b.owner_user_id;
  if (raw === undefined || raw === null || raw === "" || !/^\d+$/.test(String(raw))) {
    return { id: null, owner: trim(b.owner) };
  }
  const u = await U.findById(Number(raw));
  return u ? { id: u.id, owner: u.name } : { id: null, owner: trim(b.owner) };
}

function leadValues(b, a, ref) {
  return [
    (b.name || "").trim(),
    trim(b.phone), trim(b.email), trim(b.company), trim(b.city), trim(b.state),
    trim(b.interest), trim(b.message),
    M.isSource(b.source) ? b.source : "other",
    M.isStatus(b.status) ? b.status : "new",
    M.isPriority(b.priority) ? b.priority : "medium",
    a.owner, trim(b.next_followup), a.id,
    // Null on anything that is not a referral, so a lead moved off "Referral"
    // stops owing a commission.
    ref.referrer_id, ref.kind, ref.value,
  ];
}

router.post("/leads", async (req, res, next) => {
  try {
    // The name is checked before the referrer is created, so a lead rejected
    // for having no name cannot leave a stray referrer behind.
    if (!(req.body.name || "").trim()) return fail(res, 400, "A lead needs at least a name.");
    const ref = await R.fieldsFor(req.body);
    if (!ref.ok) return fail(res, 400, ref.message);
    const vals = leadValues(req.body, await assignment(req.body), ref);
    const r = await db.query(
      `INSERT INTO leads (name, phone, email, company, city, state, interest, message,
         source, status, priority, owner, next_followup, owner_user_id,
         referrer_id, referral_kind, referral_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`, vals);
    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'created',$3,$4)",
      [r.rows[0].id, "Lead added manually in the admin panel.", req.user.id, req.user.name]);
    ok(res, { id: r.rows[0].id }, { message: `Lead “${vals[0]}” created.` });
  } catch (e) { next(e); }
});

router.put("/leads/:id", async (req, res, next) => {
  try {
    if (!(req.body.name || "").trim()) return fail(res, 400, "A lead needs at least a name.");
    const ref = await R.fieldsFor(req.body);
    if (!ref.ok) return fail(res, 400, ref.message);
    const vals = leadValues(req.body, await assignment(req.body), ref);
    const r = await db.query(
      `UPDATE leads SET name=$1, phone=$2, email=$3, company=$4, city=$5, state=$6,
         interest=$7, message=$8, source=$9, status=$10, priority=$11, owner=$12,
         next_followup=$13, owner_user_id=$14,
         referrer_id=$15, referral_kind=$16, referral_value=$17,
         updated_at=now() WHERE id=$18 RETURNING id`,
      [...vals, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Lead not found.");
    ok(res, { id: r.rows[0].id }, { message: `Lead “${vals[0]}” saved.` });
  } catch (e) { next(e); }
});

router.delete("/leads/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM leads WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Lead not found.");
    ok(res, { deleted: true }, { message: `Lead “${r.rows[0].name}” deleted.` });
  } catch (e) { next(e); }
});

// Handing a lead to somebody, on its own. A full save is not needed, so this
// can sit on the lead itself rather than behind the edit form.
router.post("/leads/:id/assign", async (req, res, next) => {
  try {
    const own = await assignment({ owner_user_id: req.body.owner_user_id });
    const raw = req.body.owner_user_id;
    const wanted = raw !== undefined && raw !== null && raw !== "";
    if (wanted && !own.id) {
      return fail(res, 400, "That user no longer exists. Reload the page and try again.");
    }
    const r = await db.query(
      `UPDATE leads SET owner=$1, owner_user_id=$2, updated_at=now()
       WHERE id=$3 RETURNING name`,
      [own.owner, own.id, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Lead not found.");

    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'assign',$3,$4)",
      [req.params.id,
        own.id ? `Assigned to ${own.owner}.` : "Assignment removed.",
        req.user.id, req.user.name]);

    ok(res, { owner: own.owner, owner_user_id: own.id }, {
      message: own.id
        ? `${r.rows[0].name} assigned to ${own.owner}.`
        : `${r.rows[0].name} is no longer assigned to anybody.`,
    });
  } catch (e) { next(e); }
});

router.post("/leads/:id/status", async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!M.isStatus(status)) return fail(res, 400, "Unknown status.");
    const r = await db.query(
      "UPDATE leads SET status=$1, updated_at=now() WHERE id=$2 RETURNING name",
      [status, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Lead not found.");
    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'status',$3,$4)",
      [req.params.id, "Status changed to " + M.statusMeta(status).label + ".",
        req.user.id, req.user.name]);
    ok(res, { status }, { message: `${r.rows[0].name} moved to ${M.statusMeta(status).label}.` });
  } catch (e) { next(e); }
});

router.post("/leads/:id/notes", async (req, res, next) => {
  try {
    const note = (req.body.note || "").trim();
    const followup = trim(req.body.next_followup);
    if (!note && !followup) return fail(res, 400, "Add a note or a follow-up date.");
    if (note) {
      await db.query(
        "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,$3,$4,$5)",
        [req.params.id, note, req.body.kind === "call" ? "call" : "note",
          req.user.id, req.user.name]);
    }
    if (followup) {
      await db.query("UPDATE leads SET next_followup=$1, updated_at=now() WHERE id=$2",
        [followup, req.params.id]);
      await db.query(
        "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'followup',$3,$4)",
        [req.params.id, "Follow-up set for " + followup + ".", req.user.id, req.user.name]);
    }
    ok(res, { saved: true }, { message: "Activity logged." });
  } catch (e) { next(e); }
});

// ---------- service requests ----------
// Read-only on purpose: the website's Service page is the only thing that
// creates these, and the admin is just the inbox that shows what came in.
router.get("/service", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    const params = [];
    let clause = "";
    if (q) {
      params.push("%" + q + "%");
      clause = `WHERE (name ILIKE $1 OR phone ILIKE $1 OR reference ILIKE $1
                       OR machine ILIKE $1 OR state ILIKE $1 OR city ILIKE $1
                       OR issue ILIKE $1)`;
    }

    const total = parseInt((await db.query(
      `SELECT count(*) FROM service_requests ${clause}`, params)).rows[0].count, 10);
    const p = pageOf(req, total);

    const rows = (await db.query(
      `SELECT * FROM service_requests ${clause}
       ORDER BY created_at DESC, id DESC
       ${p.sql}`, params)).rows;

    const allCount = parseInt((await db.query(
      "SELECT count(*) FROM service_requests")).rows[0].count, 10);

    ok(res, rows, { meta: p.meta, all_count: allCount });
  } catch (e) { next(e); }
});

// The helpline details shown on the website's Service page. Declared before
// the /service/:id routes below, or "settings" would be read as an id.
const SVC_SETTINGS = require("../service-settings");

router.get("/service/settings", async (req, res, next) => {
  try {
    ok(res, { values: await SVC_SETTINGS.get(), defaults: SVC_SETTINGS.DEFAULTS });
  } catch (e) { next(e); }
});

router.put("/service/settings", async (req, res, next) => {
  try {
    await SVC_SETTINGS.set(req.body || {});
    ok(res, { values: await SVC_SETTINGS.get() }, { message: "Helpline details saved." });
  } catch (e) { next(e); }
});

// ---------- service type master ----------
// Every id below is matched as digits only, so a sub-resource such as
// /service/types can never be read as a request id whatever the route order.
router.get("/service/types", async (req, res, next) => {
  try {
    const p = pageOf(req, await countOf("SELECT count(*) FROM service_types"));
    const rows = (await db.query(
      `SELECT t.id, t.name, t.description,
              (SELECT count(*) FROM service_visits v WHERE v.type_id = t.id)::int AS used
       FROM service_types t ORDER BY t.name ${p.sql}`)).rows;
    ok(res, rows, { meta: p.meta });
  } catch (e) { next(e); }
});

const typeValues = (b) => [(b.name || "").trim(), trim(b.description)];

router.post("/service/types", async (req, res, next) => {
  try {
    const v = typeValues(req.body);
    if (!v[0]) return fail(res, 400, "A service type needs a name.");
    const r = await db.query(
      "INSERT INTO service_types (name, description) VALUES ($1,$2) RETURNING id", v);
    ok(res, { id: r.rows[0].id }, { message: `“${v[0]}” added.` });
  } catch (e) {
    if (e.code === "23505") return fail(res, 400, "There is already a service type with that name.");
    next(e);
  }
});

router.put("/service/types/:id(\\d+)", async (req, res, next) => {
  try {
    const v = typeValues(req.body);
    if (!v[0]) return fail(res, 400, "A service type needs a name.");
    const r = await db.query(
      "UPDATE service_types SET name=$1, description=$2 WHERE id=$3 RETURNING id",
      [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service type not found.");
    ok(res, { id: r.rows[0].id }, { message: `“${v[0]}” saved.` });
  } catch (e) {
    if (e.code === "23505") return fail(res, 400, "There is already a service type with that name.");
    next(e);
  }
});

router.delete("/service/types/:id(\\d+)", async (req, res, next) => {
  try {
    // Service history stores nothing but the type's id, so removing a type that
    // has been used would leave those records without a label.
    const used = parseInt((await db.query(
      "SELECT count(*) FROM service_visits WHERE type_id=$1", [req.params.id])).rows[0].count, 10);
    if (used) {
      return fail(res, 400,
        `This type is used by ${used} logged ${used === 1 ? "service" : "services"}, ` +
        "which would lose their label. Rename it instead — the history follows the new name.");
    }
    const r = await db.query("DELETE FROM service_types WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service type not found.");
    ok(res, { deleted: true }, { message: `“${r.rows[0].name}” deleted.` });
  } catch (e) { next(e); }
});

// ---------- service history ----------
router.get("/service/visits", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    const typeId = /^\d+$/.test(req.query.type) ? req.query.type : "";
    const where = [];
    const params = [];
    if (q) {
      params.push("%" + q + "%");
      const i = params.length;
      where.push(`(v.customer ILIKE $${i} OR v.phone ILIKE $${i} OR v.reference ILIKE $${i}
                   OR v.machine ILIKE $${i} OR v.engineer ILIKE $${i} OR v.work_done ILIKE $${i}
                   OR v.parts_used ILIKE $${i} OR v.state ILIKE $${i} OR v.city ILIKE $${i})`);
    }
    if (typeId) { params.push(typeId); where.push(`v.type_id = $${params.length}`); }
    // The two stat cards that quote a figure link here, so each needs a filter
    // that reproduces exactly what the card counted.
    if (req.query.period === "month") {
      where.push("v.service_date >= date_trunc('month', current_date)");
    }
    if (req.query.due === "1") {
      where.push("v.next_due IS NOT NULL AND v.next_due <= current_date + 30");
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";

    const total = parseInt((await db.query(
      `SELECT count(*) FROM service_visits v ${clause}`, params)).rows[0].count, 10);
    const p = pageOf(req, total);

    // Looking at what is due puts the most urgent first; everywhere else the
    // newest service is what you want to see.
    const order = req.query.due === "1"
      ? "v.next_due, v.id DESC"
      : "v.service_date DESC, v.id DESC";

    const rows = (await db.query(
      `SELECT v.*, t.name AS type_name,
              (SELECT count(*) FROM service_reviews r WHERE r.visit_id = v.id)::int AS review_count
       FROM service_visits v LEFT JOIN service_types t ON t.id = v.type_id ${clause}
       ORDER BY ${order}
       ${p.sql}`, params)).rows;

    const stats = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE service_date >= date_trunc('month', current_date))::int AS this_month,
              count(*) FILTER (WHERE next_due IS NOT NULL AND next_due <= current_date + 30)::int AS due_soon
       FROM service_visits`)).rows[0];

    const types = (await db.query(
      "SELECT id, name FROM service_types ORDER BY name")).rows;

    ok(res, rows, { meta: p.meta, stats, types });
  } catch (e) { next(e); }
});

router.get("/service/visits/:id(\\d+)", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT v.*, t.name AS type_name FROM service_visits v
       LEFT JOIN service_types t ON t.id = v.type_id WHERE v.id=$1`, [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service record not found.");
    const reviews = (await db.query(
      "SELECT * FROM service_reviews WHERE visit_id=$1 ORDER BY created_at DESC", [req.params.id])).rows;
    ok(res, { visit: r.rows[0], reviews });
  } catch (e) { next(e); }
});

function visitValues(b) {
  const int = (v) => (/^\d+$/.test(String(v || "")) ? parseInt(v, 10) : null);
  const money = (v) => {
    const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return [
    int(b.request_id), int(b.type_id),
    (b.customer || "").trim(),
    trim(b.phone), trim(b.reference), trim(b.machine), trim(b.city), trim(b.state),
    trim(b.service_date) || new Date().toISOString().slice(0, 10),
    trim(b.engineer), trim(b.work_done), trim(b.parts_used),
    money(b.charges), trim(b.next_due),
  ];
}

router.post("/service/visits", async (req, res, next) => {
  try {
    const v = visitValues(req.body);
    if (!v[2]) return fail(res, 400, "A service record needs the customer's name.");
    const r = await db.query(
      `INSERT INTO service_visits
         (request_id, type_id, customer, phone, reference, machine, city, state,
          service_date, engineer, work_done, parts_used, charges, next_due)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, v);
    ok(res, { id: r.rows[0].id }, { message: `Service for “${v[2]}” logged.` });
  } catch (e) { if (!badLink(res, e)) next(e); }
});

// A request or type can be deleted while a form sits open; say so plainly
// instead of letting a foreign-key violation read as a server fault.
function badLink(res, e) {
  if (e.code !== "23503") return false;
  const which = /type_id/.test(e.detail || "") ? "service type" : "service request";
  fail(res, 400, `That ${which} no longer exists. Reload the page and try again.`);
  return true;
}

router.put("/service/visits/:id(\\d+)", async (req, res, next) => {
  try {
    const v = visitValues(req.body);
    if (!v[2]) return fail(res, 400, "A service record needs the customer's name.");
    const r = await db.query(
      `UPDATE service_visits SET request_id=$1, type_id=$2, customer=$3, phone=$4,
         reference=$5, machine=$6, city=$7, state=$8, service_date=$9, engineer=$10,
         work_done=$11, parts_used=$12, charges=$13, next_due=$14, updated_at=now()
       WHERE id=$15 RETURNING id`, [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service record not found.");
    ok(res, { id: r.rows[0].id }, { message: `Service for “${v[2]}” saved.` });
  } catch (e) { if (!badLink(res, e)) next(e); }
});

router.delete("/service/visits/:id(\\d+)", async (req, res, next) => {
  try {
    const r = await db.query(
      "DELETE FROM service_visits WHERE id=$1 RETURNING customer", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service record not found.");
    ok(res, { deleted: true }, { message: `Service record for “${r.rows[0].customer}” deleted.` });
  } catch (e) { next(e); }
});

// ---------- customer reviews ----------
router.get("/service/reviews", async (req, res, next) => {
  try {
    const state = ["pending", "published"].includes(req.query.state) ? req.query.state : "";
    const q = (req.query.q || "").trim();
    const where = [];
    const params = [];
    if (state) where.push(state === "published" ? "r.published" : "NOT r.published");
    if (q) {
      params.push("%" + q + "%");
      const i = params.length;
      where.push(`(r.customer ILIKE $${i} OR r.company ILIKE $${i} OR r.machine ILIKE $${i}
                   OR r.comment ILIKE $${i} OR r.state ILIKE $${i} OR r.city ILIKE $${i})`);
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";

    const p = pageOf(req, await countOf(
      `SELECT count(*) FROM service_reviews r ${clause}`, params));

    const rows = (await db.query(
      `SELECT r.*, v.service_date, v.reference AS visit_reference,
              u.name AS collected_by
       FROM service_reviews r
       LEFT JOIN service_visits v ON v.id = r.visit_id
       LEFT JOIN users u ON u.id = r.user_id ${clause}
       ORDER BY r.published, r.created_at DESC ${p.sql}`, params)).rows;

    const counts = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE published)::int AS published,
              count(*) FILTER (WHERE NOT published)::int AS pending,
              round(avg(rating) FILTER (WHERE published), 1) AS avg_published
       FROM service_reviews`)).rows[0];

    ok(res, rows, { meta: p.meta, counts });
  } catch (e) { next(e); }
});

function reviewValues(b) {
  const rating = parseInt(b.rating, 10);
  return [
    /^\d+$/.test(String(b.visit_id || "")) ? parseInt(b.visit_id, 10) : null,
    (b.customer || "").trim(),
    trim(b.company), trim(b.city), trim(b.state), trim(b.machine),
    rating >= 1 && rating <= 5 ? rating : 5,
    trim(b.comment),
    b.published === "on" || b.published === true || b.published === "true",
  ];
}

router.post("/service/reviews", async (req, res, next) => {
  try {
    const v = reviewValues(req.body);
    if (!v[1]) return fail(res, 400, "A review needs the customer's name.");
    const r = await db.query(
      `INSERT INTO service_reviews
         (visit_id, customer, company, city, state, machine, rating, comment, published, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'admin') RETURNING id`, v);
    ok(res, { id: r.rows[0].id }, { message: `Review from “${v[1]}” added.` });
  } catch (e) { next(e); }
});

router.put("/service/reviews/:id(\\d+)", async (req, res, next) => {
  try {
    const v = reviewValues(req.body);
    if (!v[1]) return fail(res, 400, "A review needs the customer's name.");
    const r = await db.query(
      `UPDATE service_reviews SET visit_id=$1, customer=$2, company=$3, city=$4, state=$5,
         machine=$6, rating=$7, comment=$8, published=$9 WHERE id=$10 RETURNING id`,
      [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Review not found.");
    ok(res, { id: r.rows[0].id }, { message: "Review saved." });
  } catch (e) { next(e); }
});

router.post("/service/reviews/:id(\\d+)/publish", async (req, res, next) => {
  try {
    const on = !(req.body.published === false || req.body.published === "false");
    const r = await db.query(
      "UPDATE service_reviews SET published=$1 WHERE id=$2 RETURNING customer", [on, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Review not found.");
    ok(res, { published: on }, {
      message: on
        ? `Review from “${r.rows[0].customer}” is now on the website.`
        : `Review from “${r.rows[0].customer}” taken off the website.`,
    });
  } catch (e) { next(e); }
});

router.delete("/service/reviews/:id(\\d+)", async (req, res, next) => {
  try {
    const r = await db.query(
      "DELETE FROM service_reviews WHERE id=$1 RETURNING customer", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Review not found.");
    ok(res, { deleted: true }, { message: `Review from “${r.rows[0].customer}” deleted.` });
  } catch (e) { next(e); }
});

// ---------- a single service request ----------
router.get("/service/:id(\\d+)", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM service_requests WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service request not found.");
    const req_ = r.rows[0];

    // What has already been done for this machine, matched on the invoice
    // number first and the phone number otherwise.
    const history = (await db.query(
      `SELECT v.id, v.service_date, v.engineer, v.work_done, t.name AS type_name
       FROM service_visits v LEFT JOIN service_types t ON t.id = v.type_id
       WHERE ($1 <> '' AND v.reference = $1) OR ($2 <> '' AND v.phone = $2)
       ORDER BY v.service_date DESC, v.id DESC LIMIT 8`,
      [req_.reference || "", req_.phone || ""])).rows;

    ok(res, { request: req_, history });
  } catch (e) { next(e); }
});

router.delete("/service/:id(\\d+)", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM service_requests WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Service request not found.");
    ok(res, { deleted: true }, { message: `Service request for “${r.rows[0].name}” deleted.` });
  } catch (e) { next(e); }
});

// A stale service link (the old /service/new page, for instance) gets a clear
// answer rather than falling through to the shell's generic 404.
router.all("/service/:id", (req, res) => fail(res, 404, "Service request not found."));

// ---------- website content overview ----------
router.get("/website", async (req, res, next) => {
  try {
    const counts = (await db.query(
      `SELECT (SELECT count(*) FROM categories)::int cats,
              (SELECT count(*) FROM products)::int products,
              (SELECT count(*) FROM spare_groups)::int groups,
              (SELECT count(*) FROM spares)::int spares,
              (SELECT count(*) FROM locations)::int locations,
              (SELECT count(*) FROM regional_contacts)::int regions`)).rows[0];
    const byCategory = (await db.query(
      `SELECT c.id, c.name, c.slug, count(p.id)::int AS n
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.sort_order, c.id`)).rows;
    const noPhoto = (await db.query(
      `SELECT 'product' AS kind, id, name FROM products WHERE image IS NULL OR image = ''
       UNION ALL
       SELECT 'spare' AS kind, id, name FROM spares WHERE image IS NULL OR image = ''
       ORDER BY kind, name`)).rows;
    const orphans = (await db.query(
      "SELECT id, name FROM products WHERE category_id IS NULL ORDER BY name")).rows;
    ok(res, { counts, byCategory, noPhoto, orphans });
  } catch (e) { next(e); }
});

// ---------- categories ----------
router.get("/categories", async (req, res, next) => {
  try {
    const p = pageOf(req, await countOf("SELECT count(*) FROM categories"));
    ok(res, (await db.query(
      `SELECT c.*, (SELECT count(*) FROM products p WHERE p.category_id = c.id)::int AS product_count
       FROM categories c ORDER BY c.sort_order, c.id ${p.sql}`)).rows, { meta: p.meta });
  } catch (e) { next(e); }
});
router.get("/categories/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM categories WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Category not found.");
    ok(res, r.rows[0]);
  } catch (e) { next(e); }
});
function categoryValues(b) {
  return [b.name, b.slug, b.count_label || "machines", intOr0(b.cols) || 3, intOr0(b.sort_order)];
}
router.post("/categories", async (req, res, next) => {
  try {
    const v = categoryValues(req.body);
    if (!v[0] || !v[1]) return fail(res, 400, "Name and slug are required.");
    const r = await db.query(
      "INSERT INTO categories (name, slug, count_label, cols, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id", v);
    ok(res, { id: r.rows[0].id }, { message: `Category “${v[0]}” created.` });
  } catch (e) { next(e); }
});
router.put("/categories/:id", async (req, res, next) => {
  try {
    const v = categoryValues(req.body);
    if (!v[0] || !v[1]) return fail(res, 400, "Name and slug are required.");
    const r = await db.query(
      "UPDATE categories SET name=$1, slug=$2, count_label=$3, cols=$4, sort_order=$5 WHERE id=$6 RETURNING id",
      [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Category not found.");
    ok(res, { id: r.rows[0].id }, { message: `Category “${v[0]}” saved.` });
  } catch (e) { next(e); }
});
router.delete("/categories/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM categories WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Category not found.");
    ok(res, { deleted: true }, { message: `Category “${r.rows[0].name}” deleted.` });
  } catch (e) { next(e); }
});

// ---------- products ----------
router.get("/products", async (req, res, next) => {
  try {
    const pg = pageOf(req, await countOf("SELECT count(*) FROM products"));
    ok(res, (await db.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order NULLS LAST, p.sort_order, p.id ${pg.sql}`)).rows, { meta: pg.meta });
  } catch (e) { next(e); }
});
router.get("/products/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM products WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Product not found.");
    ok(res, r.rows[0]);
  } catch (e) { next(e); }
});
function productValues(req) {
  const b = req.body;
  return [
    b.category_id || null, b.slug, b.name,
    b.price || "Price on request", trim(b.price_note),
    pickImage(req), trim(b.card_desc), trim(b.tag), trim(b.intro),
    trim(b.spec_title), trim(b.note),
    JSON.stringify(linesToFeatures(b.features)),
    JSON.stringify(linesToSpecs(b.specs)),
    b.show_in_grid === "on" || b.show_in_grid === "true" || b.show_in_grid === true,
    trim(b.detail_slug), intOr0(b.sort_order),
  ];
}
router.post("/products", upload.single("image_file"), async (req, res, next) => {
  try {
    const v = productValues(req);
    if (!v[2] || !v[1]) return fail(res, 400, "Name and slug are required.");
    const r = await db.query(
      `INSERT INTO products (category_id, slug, name, price, price_note, image, card_desc, tag,
         intro, spec_title, note, features, specs, show_in_grid, detail_slug, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, v);
    ok(res, { id: r.rows[0].id }, { message: `Product “${v[2]}” created.` });
  } catch (e) { next(e); }
});
router.put("/products/:id", upload.single("image_file"), async (req, res, next) => {
  try {
    const v = productValues(req);
    if (!v[2] || !v[1]) return fail(res, 400, "Name and slug are required.");
    const r = await db.query(
      `UPDATE products SET category_id=$1, slug=$2, name=$3, price=$4, price_note=$5, image=$6,
         card_desc=$7, tag=$8, intro=$9, spec_title=$10, note=$11, features=$12, specs=$13,
         show_in_grid=$14, detail_slug=$15, sort_order=$16 WHERE id=$17 RETURNING id`,
      [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Product not found.");
    ok(res, { id: r.rows[0].id }, { message: `Product “${v[2]}” saved.` });
  } catch (e) { next(e); }
});
router.delete("/products/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM products WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Product not found.");
    ok(res, { deleted: true }, { message: `Product “${r.rows[0].name}” deleted.` });
  } catch (e) { next(e); }
});

// ---------- spare groups and spares ----------
router.get("/spares", async (req, res, next) => {
  try {
    const p = pageOf(req, await countOf("SELECT count(*) FROM spares"));
    const groups = (await db.query("SELECT * FROM spare_groups ORDER BY sort_order, id")).rows;
    const spares = (await db.query(
      `SELECT * FROM spares ORDER BY sort_order, id ${p.sql}`)).rows;
    ok(res, { groups, spares }, { meta: p.meta });
  } catch (e) { next(e); }
});
router.get("/spares/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM spares WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Spare not found.");
    ok(res, r.rows[0]);
  } catch (e) { next(e); }
});
function spareValues(req) {
  const b = req.body;
  return [b.group_id || null, b.name, trim(b.description), pickImage(req), intOr0(b.sort_order)];
}
router.post("/spares", upload.single("image_file"), async (req, res, next) => {
  try {
    const v = spareValues(req);
    if (!v[1]) return fail(res, 400, "A name is required.");
    const r = await db.query(
      "INSERT INTO spares (group_id, name, description, image, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id", v);
    ok(res, { id: r.rows[0].id }, { message: `Spare “${v[1]}” created.` });
  } catch (e) { next(e); }
});
router.put("/spares/:id", upload.single("image_file"), async (req, res, next) => {
  try {
    const v = spareValues(req);
    if (!v[1]) return fail(res, 400, "A name is required.");
    const r = await db.query(
      "UPDATE spares SET group_id=$1, name=$2, description=$3, image=$4, sort_order=$5 WHERE id=$6 RETURNING id",
      [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Spare not found.");
    ok(res, { id: r.rows[0].id }, { message: `Spare “${v[1]}” saved.` });
  } catch (e) { next(e); }
});
router.delete("/spares/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM spares WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Spare not found.");
    ok(res, { deleted: true }, { message: `Spare “${r.rows[0].name}” deleted.` });
  } catch (e) { next(e); }
});

router.get("/spare-groups/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM spare_groups WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Group not found.");
    ok(res, r.rows[0]);
  } catch (e) { next(e); }
});
router.post("/spare-groups", async (req, res, next) => {
  try {
    if (!req.body.name) return fail(res, 400, "A name is required.");
    const r = await db.query(
      "INSERT INTO spare_groups (name, sort_order) VALUES ($1,$2) RETURNING id",
      [req.body.name, intOr0(req.body.sort_order)]);
    ok(res, { id: r.rows[0].id }, { message: `Group “${req.body.name}” created.` });
  } catch (e) { next(e); }
});
router.put("/spare-groups/:id", async (req, res, next) => {
  try {
    if (!req.body.name) return fail(res, 400, "A name is required.");
    const r = await db.query(
      "UPDATE spare_groups SET name=$1, sort_order=$2 WHERE id=$3 RETURNING id",
      [req.body.name, intOr0(req.body.sort_order), req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Group not found.");
    ok(res, { id: r.rows[0].id }, { message: `Group “${req.body.name}” saved.` });
  } catch (e) { next(e); }
});
router.delete("/spare-groups/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM spare_groups WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Group not found.");
    ok(res, { deleted: true }, { message: `Group “${r.rows[0].name}” and its spares deleted.` });
  } catch (e) { next(e); }
});

// ---------- locations ----------
router.get("/locations", async (req, res, next) => {
  try {
    const p = pageOf(req, await countOf("SELECT count(*) FROM locations"));
    ok(res, (await db.query(
      `SELECT * FROM locations ORDER BY sort_order, id ${p.sql}`)).rows, { meta: p.meta });
  } catch (e) { next(e); }
});
router.get("/locations/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM locations WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Location not found.");
    ok(res, r.rows[0]);
  } catch (e) { next(e); }
});
function locationValues(b) {
  return [b.title, trim(b.address), JSON.stringify(linesToPhones(b.phones)),
          trim(b.map_url), intOr0(b.sort_order)];
}
router.post("/locations", async (req, res, next) => {
  try {
    if (!req.body.title) return fail(res, 400, "A title is required.");
    const r = await db.query(
      "INSERT INTO locations (title, address, phones, map_url, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      locationValues(req.body));
    ok(res, { id: r.rows[0].id }, { message: `Location “${req.body.title}” created.` });
  } catch (e) { next(e); }
});
router.put("/locations/:id", async (req, res, next) => {
  try {
    if (!req.body.title) return fail(res, 400, "A title is required.");
    const r = await db.query(
      "UPDATE locations SET title=$1, address=$2, phones=$3, map_url=$4, sort_order=$5 WHERE id=$6 RETURNING id",
      [...locationValues(req.body), req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Location not found.");
    ok(res, { id: r.rows[0].id }, { message: `Location “${req.body.title}” saved.` });
  } catch (e) { next(e); }
});
router.delete("/locations/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM locations WHERE id=$1 RETURNING title", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Location not found.");
    ok(res, { deleted: true }, { message: `Location “${r.rows[0].title}” deleted.` });
  } catch (e) { next(e); }
});

// ---------- regional contacts ----------
router.get("/regions", async (req, res, next) => {
  try {
    const p = pageOf(req, await countOf("SELECT count(*) FROM regional_contacts"));
    ok(res, (await db.query(
      `SELECT * FROM regional_contacts ORDER BY sort_order, id ${p.sql}`)).rows, { meta: p.meta });
  } catch (e) { next(e); }
});
router.get("/regions/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM regional_contacts WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Region not found.");
    ok(res, r.rows[0]);
  } catch (e) { next(e); }
});
router.post("/regions", async (req, res, next) => {
  try {
    if (!req.body.region || !req.body.phone) return fail(res, 400, "Region and phone are required.");
    const r = await db.query(
      "INSERT INTO regional_contacts (region, phone, sort_order) VALUES ($1,$2,$3) RETURNING id",
      [req.body.region, req.body.phone, intOr0(req.body.sort_order)]);
    ok(res, { id: r.rows[0].id }, { message: `“${req.body.region}” added.` });
  } catch (e) { next(e); }
});
router.put("/regions/:id", async (req, res, next) => {
  try {
    if (!req.body.region || !req.body.phone) return fail(res, 400, "Region and phone are required.");
    const r = await db.query(
      "UPDATE regional_contacts SET region=$1, phone=$2, sort_order=$3 WHERE id=$4 RETURNING id",
      [req.body.region, req.body.phone, intOr0(req.body.sort_order), req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Region not found.");
    ok(res, { id: r.rows[0].id }, { message: `“${req.body.region}” saved.` });
  } catch (e) { next(e); }
});
router.delete("/regions/:id", async (req, res, next) => {
  try {
    const r = await db.query("DELETE FROM regional_contacts WHERE id=$1 RETURNING region", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Region not found.");
    ok(res, { deleted: true }, { message: `“${r.rows[0].region}” removed.` });
  } catch (e) { next(e); }
});

// ---------- Meta integration ----------
router.get("/meta", async (req, res, next) => {
  try {
    const cfg = await meta.getConfig();
    if (!cfg.meta_verify_token) {
      cfg.meta_verify_token = "visbot-" + crypto.randomBytes(8).toString("hex");
      await meta.setConfig({ meta_verify_token: cfg.meta_verify_token });
    }
    const stats = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at >= current_date - interval '7 days')::int AS week
       FROM leads WHERE meta_leadgen_id IS NOT NULL`)).rows[0];
    const campaigns = (await db.query(
      `SELECT meta_campaign_name AS name, count(*)::int AS n FROM leads
       WHERE meta_campaign_name IS NOT NULL AND meta_campaign_name <> ''
       GROUP BY 1 ORDER BY n DESC LIMIT 8`)).rows;
    const logs = (await db.query(
      "SELECT * FROM integration_log WHERE channel='meta' ORDER BY created_at DESC, id DESC LIMIT 5")).rows;

    const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0];
    const base = (process.env.BACKEND_PUBLIC_URL || "").replace(/\/$/, "")
      || proto + "://" + req.get("host");

    ok(res, {
      config: {
        meta_app_id: cfg.meta_app_id || "",
        meta_page_id: cfg.meta_page_id || "",
        meta_form_ids: cfg.meta_form_ids || "",
        meta_api_version: cfg.meta_api_version,
        meta_verify_token: cfg.meta_verify_token || "",
        app_secret_masked: meta.mask(cfg.meta_app_secret),
        page_token_masked: meta.mask(cfg.meta_page_token),
        has_app_secret: !!cfg.meta_app_secret,
        has_page_token: !!cfg.meta_page_token,
        last_sync: cfg.meta_last_sync,
        last_webhook: cfg.meta_last_webhook,
      },
      stats, campaigns, logs,
      webhook_url: base + "/api/meta/webhook",
      is_local: /localhost|127\.0\.0\.1|\[::1\]/i.test(base),
    });
  } catch (e) { next(e); }
});

router.put("/meta", async (req, res, next) => {
  try {
    const b = req.body;
    const values = {
      meta_app_id: b.meta_app_id,
      meta_page_id: b.meta_page_id,
      meta_form_ids: b.meta_form_ids,
      meta_api_version: b.meta_api_version || meta.DEFAULT_API_VERSION,
      meta_verify_token: b.meta_verify_token,
    };
    if (b.meta_app_secret && !b.meta_app_secret.startsWith("••")) values.meta_app_secret = b.meta_app_secret;
    if (b.meta_page_token && !b.meta_page_token.startsWith("••")) values.meta_page_token = b.meta_page_token;
    await meta.setConfig(values);
    await meta.log("config", "ok", "Integration settings updated.");
    ok(res, { saved: true }, { message: "Meta settings saved." });
  } catch (e) { next(e); }
});

router.post("/meta/verify-token", async (req, res, next) => {
  try {
    const token = "visbot-" + crypto.randomBytes(8).toString("hex");
    await meta.setConfig({ meta_verify_token: token });
    ok(res, { token }, { message: "New verify token generated." });
  } catch (e) { next(e); }
});

router.post("/meta/test", async (req, res, next) => {
  try {
    const cfg = await meta.getConfig();
    const out = await meta.testConnection(cfg);
    await meta.log("test", "ok", `Connected to Page “${out.page.name}”, ${out.forms.length} form(s) visible.`);
    ok(res, {
      page: out.page,
      forms: out.forms,
      forms_error: out.formsError || null,
    }, { message: `Connected to “${out.page.name}”.` });
  } catch (e) {
    await meta.log("test", "error", e.message);
    fail(res, 400, e.message);
  }
});

router.post("/meta/sync", async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.body.days, 10) || 30));
    const cfg = await meta.getConfig();
    const r = await meta.syncLeads(cfg, days);
    ok(res, r, {
      message: r.created
        ? `Imported ${r.created} new lead${r.created === 1 ? "" : "s"} (${r.skipped} already present).`
        : `No new leads — ${r.skipped} already in the system.`,
    });
  } catch (e) {
    await meta.log("sync", "error", e.message);
    fail(res, 400, e.message);
  }
});

const csvUpload = require("multer")({
  storage: require("multer").memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
router.post("/meta/import", csvUpload.single("csv"), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return fail(res, 400, "Choose a CSV file exported from Meta first.");
    }
    const b = req.file.buffer;
    const text = (b.length > 1 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)))
      ? b.toString("utf16le") : b.toString("utf8");
    const r = await meta.importCsv(text);
    ok(res, r, {
      message: `Import finished: ${r.created} new, ${r.skipped} already present` +
        (r.failed ? `, ${r.failed} row(s) skipped` : "") + ".",
    });
  } catch (e) {
    await meta.log("csv", "error", e.message);
    fail(res, 400, e.message);
  }
});

// ---------- errors ----------
router.use((err, req, res, next) => {
  console.error("admin api error:", err.message);
  const dup = err.code === "23505" || /duplicate key/.test(err.message || "");
  res.status(dup ? 409 : 500).json({
    error: { message: dup ? "That slug is already used by another record." : "Server error." },
  });
});

module.exports = router;
