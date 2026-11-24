// Sales app API — served by the backend at backend.visbot.in/api/app.
//
// This is the private half of the backend: every route except the service
// description and the login needs a bearer token, which the app gets by signing
// in with the same username and password the panel uses.
//
//   Authorization: Bearer <token>
//
// Tokens are used instead of cookies, so there is nothing for a browser to send
// automatically and no CSRF surface. A sales user only ever sees the leads
// assigned to them; an admin or manager signing in to the app sees everything.
const router = require("express").Router();
const db = require("../db");
const M = require("../leads-meta");
const U = require("../users");
const ST = require("../states");
const svc = require("../service-settings");

const ok = (res, data, extra) => res.json(Object.assign({ data }, extra || {}));
const fail = (res, code, message) => res.status(code).json({ error: { message } });
const trim = (v) => String(v == null ? "" : v).trim() || null;
const PER_PAGE = 25;

// ---------------------------------------------------------------- throttling
// Failures are counted per IP and per username, so one rep's typo cannot lock
// out the whole office, and a password guesser cannot work through a list.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function recent(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) attempts.set(key, list); else attempts.delete(key);
  return list;
}
function lockedMinutes(keys) {
  let worst = 0;
  for (const k of keys) {
    const list = recent(k);
    if (list.length >= MAX_ATTEMPTS) {
      worst = Math.max(worst, Math.ceil((WINDOW_MS - (Date.now() - list[0])) / 60000));
    }
  }
  return worst;
}
function recordFailure(keys) {
  for (const k of keys) {
    const list = recent(k);
    list.push(Date.now());
    attempts.set(k, list);
  }
  if (attempts.size > 2000) attempts.clear();
}
const throttleKeys = (req, identifier) =>
  ["ip:" + req.ip, "user:" + String(identifier || "").trim().toLowerCase()];

// ---------------------------------------------------------------- open routes
router.get("/", (req, res) => {
  ok(res, {
    service: "Visbot Sales app API",
    version: "1",
    auth: "Bearer token from POST /api/app/login",
    endpoints: [
      "POST /api/app/login",
      "POST /api/app/logout",
      "GET  /api/app/me",
      "POST /api/app/me/password",
      "GET  /api/app/bootstrap",
      "GET  /api/app/dashboard",
      "GET  /api/app/leads?status=&q=&due=&page=",
      "POST /api/app/leads",
      "GET  /api/app/leads/:id",
      "PUT  /api/app/leads/:id",
      "POST /api/app/leads/:id/status",
      "POST /api/app/leads/:id/notes",
      "GET  /api/app/reviews",
      "POST /api/app/reviews",
    ],
  });
});

router.post("/login", async (req, res, next) => {
  try {
    const body = req.body || {};
    // A mobile number or an email address. `username` is still read so an older
    // build of the app keeps working.
    const identifier = body.identifier === undefined ? body.username : body.identifier;
    const { password, device } = body;

    const keys = throttleKeys(req, identifier);
    const mins = lockedMinutes(keys);
    if (mins > 0) {
      return fail(res, 429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
    }

    const row = await U.findByLogin(identifier);
    if (!row || !await U.verifyPassword(password, row.password_hash)) {
      recordFailure(keys);
      return fail(res, 401, "Wrong mobile number, email address or password.");
    }
    if (!row.active) {
      return fail(res, 403, "That account has been switched off. Ask the office to turn it back on.");
    }
    if (!U.can(row.role, "app")) {
      return fail(res, 403, "That account cannot use the sales app.");
    }

    for (const k of keys) attempts.delete(k);
    const { token, days } = await U.issueToken(row.id, device);
    await U.touchLogin(row.id, { app: true });
    ok(res, {
      token,
      expires_in_days: days,
      user: U.publicUser(row),
    }, { message: `Signed in as ${row.name}.` });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- the guard
router.use(async (req, res, next) => {
  try {
    const header = req.get("authorization") || "";
    const token = /^Bearer\s+(.+)$/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
    if (!token) return fail(res, 401, "Sign in to continue.");
    const user = await U.userForToken(token);
    if (!user) return fail(res, 401, "Your session has expired. Sign in again.");
    if (!U.can(user.role, "app")) return fail(res, 403, "That account cannot use the sales app.");
    req.user = user;
    req.token = token;
    next();
  } catch (e) { next(e); }
});

router.post("/logout", async (req, res, next) => {
  try {
    await U.revokeToken(req.token);
    ok(res, { signed_out: true }, { message: "Signed out." });
  } catch (e) { next(e); }
});

router.get("/me", (req, res) => ok(res, U.publicUser(req.user)));

router.post("/me/password", async (req, res, next) => {
  try {
    const { current_password, password } = req.body || {};
    const hash = await U.hashFor(req.user.id);
    if (!hash || !await U.verifyPassword(current_password, hash)) {
      return fail(res, 400, "That is not your current password.");
    }
    const problem = U.passwordProblem(password);
    if (problem) return fail(res, 400, problem);
    // Every token is dropped, including this one: the app signs in again with
    // the new password.
    await U.setPassword(req.user.id, password);
    ok(res, { saved: true }, { message: "Password changed. Please sign in again." });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- lead scoping
// What a sales user may see:
//
//   · every lead assigned to them, wherever it is, and
//   · every lead in a state they cover that nobody else has been given.
//
// So a territory brings in the new enquiries from it, while an explicit
// assignment always wins — two reps covering one state never both chase the
// same customer. The clause is added to every lead query rather than checked
// afterwards, so nothing can leak through a filter.
function scope(req, params, alias = "l") {
  if (U.leadScope(req.user.role) !== "own") return "";
  params.push(req.user.id);
  const p = `$${params.length}`;
  return `(${alias}.owner_user_id = ${p}
           OR (${alias}.owner_user_id IS NULL
               AND ${alias}.state_id IN (SELECT state_id FROM user_states WHERE user_id = ${p})))`;
}

const canSeeAllLeads = (req) => U.leadScope(req.user.role) === "all";

// ---------------------------------------------------------------- bootstrap
// One call the app makes after signing in: the vocabulary for its dropdowns, the
// machine list, and the numbers to put on the "call us" screen.
router.get("/bootstrap", async (req, res, next) => {
  try {
    const machines = (await db.query(
      "SELECT name FROM products WHERE show_in_grid ORDER BY sort_order, name")).rows
      .map((r) => r.name);
    const helpline = await svc.get();
    ok(res, {
      user: U.publicUser(req.user),
      statuses: M.STATUSES.map((s) => ({ key: s.key, label: s.label })),
      sources: M.SOURCES,
      priorities: M.PRIORITIES.map((p) => ({ key: p.key, label: p.label })),
      open_statuses: M.OPEN_STATUSES,
      machines,
      helpline,
      // Every state, for the state field on the lead form, and the ones this
      // person covers, which is what their lead list is built from.
      states: await ST.list(),
      my_states: await ST.forUser(req.user.id),
      can_assign: canSeeAllLeads(req),
      team: canSeeAllLeads(req)
        ? (await U.assignable()).map((u) => ({ id: u.id, name: u.name, role: u.role }))
        : [],
    });
  } catch (e) { next(e); }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const params = [];
    const mine = scope(req, params);
    const clause = mine ? "WHERE " + mine : "";
    const stats = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'new')::int AS new_count,
              count(*) FILTER (WHERE status NOT IN ('won','lost'))::int AS open_count,
              count(*) FILTER (WHERE status = 'won')::int AS won_count,
              count(*) FILTER (WHERE created_at >= date_trunc('month', current_date))::int AS month_count,
              count(*) FILTER (WHERE next_followup IS NOT NULL
                                 AND next_followup <= current_date
                                 AND status NOT IN ('won','lost'))::int AS due_count
       FROM leads l ${clause}`, params)).rows[0];

    const due = (await db.query(
      `SELECT l.id, l.name, l.company, l.phone, l.status, l.priority, l.next_followup
       FROM leads l
       WHERE l.next_followup IS NOT NULL AND l.status NOT IN ('won','lost')
         AND l.next_followup <= current_date + 3
         ${mine ? "AND " + mine : ""}
       ORDER BY l.next_followup, l.id DESC LIMIT 10`, params)).rows;

    const reviews = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE published)::int AS published
       FROM service_reviews WHERE user_id = $1`, [req.user.id])).rows[0];

    ok(res, { stats, due, reviews });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- leads
const leadCols = `l.id, l.name, l.phone, l.email, l.company, l.city, l.state,
                  l.interest, l.message, l.source, l.status, l.priority, l.owner,
                  l.owner_user_id, l.next_followup, l.created_at, l.updated_at`;

router.get("/leads", async (req, res, next) => {
  try {
    const params = [];
    const where = [];
    const mine = scope(req, params);
    if (mine) where.push(mine);

    if (M.isStatus(req.query.status)) { params.push(req.query.status); where.push(`l.status = $${params.length}`); }
    if (M.isSource(req.query.source)) { params.push(req.query.source); where.push(`l.source = $${params.length}`); }
    // Narrowing to one of the states they cover. The scope above still applies,
    // so this can only ever shrink what they already see.
    if (/^\d+$/.test(req.query.state || "")) {
      params.push(req.query.state);
      where.push(`l.state_id = $${params.length}`);
    }
    const q = (req.query.q || "").trim();
    if (q) {
      params.push("%" + q + "%");
      const i = params.length;
      where.push(`(l.name ILIKE $${i} OR l.phone ILIKE $${i} OR l.company ILIKE $${i}
                   OR l.city ILIKE $${i} OR l.interest ILIKE $${i})`);
    }
    if (req.query.due === "1") {
      where.push("l.next_followup IS NOT NULL AND l.next_followup <= current_date AND l.status NOT IN ('won','lost')");
    }
    if (req.query.open === "1") where.push("l.status NOT IN ('won','lost')");

    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = parseInt((await db.query(
      `SELECT count(*) FROM leads l ${clause}`, params)).rows[0].count, 10);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);

    const rows = (await db.query(
      `SELECT ${leadCols},
              (SELECT count(*) FROM lead_notes n WHERE n.lead_id = l.id)::int AS note_count
       FROM leads l ${clause}
       ORDER BY CASE WHEN l.status = 'new' THEN 0 ELSE 1 END,
                CASE l.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                l.created_at DESC
       LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, params)).rows;

    // Tab counts ignore the filters but keep the scope, and are built with their
    // own parameter list rather than borrowing the one above.
    const countParams = [];
    const countScope = scope(req, countParams);
    const counts = (await db.query(
      `SELECT status, count(*)::int AS n FROM leads l
       ${countScope ? "WHERE " + countScope : ""} GROUP BY status`, countParams)).rows
      .reduce((a, r) => (a[r.status] = r.n, a), {});

    ok(res, rows, { meta: { total, page, pages, per_page: PER_PAGE }, status_counts: counts });
  } catch (e) { next(e); }
});

// Reads one lead within the caller's scope, or null.
async function leadFor(req, id) {
  const params = [id];
  const mine = scope(req, params);
  const { rows } = await db.query(
    `SELECT ${leadCols} FROM leads l WHERE l.id = $1 ${mine ? "AND " + mine : ""}`, params);
  return rows[0] || null;
}

router.get("/leads/:id(\\d+)", async (req, res, next) => {
  try {
    const lead = await leadFor(req, req.params.id);
    if (!lead) return fail(res, 404, "Lead not found.");
    const notes = (await db.query(
      `SELECT id, note, kind, author, created_at FROM lead_notes
       WHERE lead_id = $1 ORDER BY created_at DESC, id DESC`, [lead.id])).rows;
    ok(res, { lead, notes });
  } catch (e) { next(e); }
});

// Who a lead belongs to. A sales user may only ever hold their own leads, so
// their own id is forced whatever the request asked for.
async function ownerFor(req, body, existing) {
  if (!canSeeAllLeads(req)) return { id: req.user.id, owner: req.user.name };
  const raw = body.owner_user_id;
  if (raw === undefined) {
    return existing
      ? { id: existing.owner_user_id, owner: existing.owner }
      : { id: req.user.id, owner: req.user.name };
  }
  if (raw === null || raw === "" || !/^\d+$/.test(String(raw))) return { id: null, owner: null };
  const u = await U.findById(Number(raw));
  return u ? { id: u.id, owner: u.name } : { id: null, owner: null };
}

router.post("/leads", async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = (b.name || "").trim();
    if (!name) return fail(res, 400, "A lead needs at least a name.");
    if (!trim(b.phone) && !trim(b.email)) {
      return fail(res, 400, "Add a phone number or an email address, so the lead can be followed up.");
    }
    const own = await ownerFor(req, b, null);
    const { rows } = await db.query(
      `INSERT INTO leads (name, phone, email, company, city, state, interest, message,
         source, status, priority, owner, owner_user_id, next_followup)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [name, trim(b.phone), trim(b.email), trim(b.company), trim(b.city), trim(b.state),
        trim(b.interest), trim(b.message),
        M.isSource(b.source) ? b.source : "app",
        M.isStatus(b.status) ? b.status : "new",
        M.isPriority(b.priority) ? b.priority : "medium",
        own.owner, own.id, trim(b.next_followup)]);

    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'created',$3,$4)",
      [rows[0].id, `Lead added from the sales app by ${req.user.name}.`, req.user.id, req.user.name]);

    ok(res, { id: rows[0].id }, { message: `${name} added.` });
  } catch (e) { next(e); }
});

router.put("/leads/:id(\\d+)", async (req, res, next) => {
  try {
    const existing = await leadFor(req, req.params.id);
    if (!existing) return fail(res, 404, "Lead not found.");
    const b = req.body || {};
    const name = (b.name === undefined ? existing.name : (b.name || "").trim());
    if (!name) return fail(res, 400, "A lead needs at least a name.");

    // Anything left out of the request keeps the value it already had, so the
    // app can send a single edited field.
    const keep = (key, value) => (value === undefined ? existing[key] : trim(value));
    const own = await ownerFor(req, b, existing);

    const { rows } = await db.query(
      `UPDATE leads SET name=$1, phone=$2, email=$3, company=$4, city=$5, state=$6,
         interest=$7, message=$8, source=$9, status=$10, priority=$11,
         owner=$12, owner_user_id=$13, next_followup=$14, updated_at=now()
       WHERE id=$15 RETURNING id`,
      [name, keep("phone", b.phone), keep("email", b.email), keep("company", b.company),
        keep("city", b.city), keep("state", b.state), keep("interest", b.interest),
        keep("message", b.message),
        M.isSource(b.source) ? b.source : existing.source,
        M.isStatus(b.status) ? b.status : existing.status,
        M.isPriority(b.priority) ? b.priority : existing.priority,
        own.owner, own.id,
        b.next_followup === undefined ? existing.next_followup : trim(b.next_followup),
        existing.id]);

    ok(res, { id: rows[0].id }, { message: `${name} saved.` });
  } catch (e) { next(e); }
});

router.post("/leads/:id(\\d+)/status", async (req, res, next) => {
  try {
    const lead = await leadFor(req, req.params.id);
    if (!lead) return fail(res, 404, "Lead not found.");
    const status = (req.body || {}).status;
    if (!M.isStatus(status)) return fail(res, 400, "Unknown status.");
    await db.query("UPDATE leads SET status=$1, updated_at=now() WHERE id=$2", [status, lead.id]);
    await db.query(
      "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'status',$3,$4)",
      [lead.id, "Status changed to " + M.statusMeta(status).label + ".", req.user.id, req.user.name]);
    ok(res, { status }, { message: `${lead.name} moved to ${M.statusMeta(status).label}.` });
  } catch (e) { next(e); }
});

router.post("/leads/:id(\\d+)/notes", async (req, res, next) => {
  try {
    const lead = await leadFor(req, req.params.id);
    if (!lead) return fail(res, 404, "Lead not found.");
    const b = req.body || {};
    const note = (b.note || "").trim();
    const followup = trim(b.next_followup);
    if (!note && !followup) return fail(res, 400, "Add a note or a follow-up date.");

    if (note) {
      await db.query(
        "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,$3,$4,$5)",
        [lead.id, note, ["call", "visit", "note"].includes(b.kind) ? b.kind : "note",
          req.user.id, req.user.name]);
    }
    if (followup) {
      await db.query("UPDATE leads SET next_followup=$1, updated_at=now() WHERE id=$2",
        [followup, lead.id]);
      await db.query(
        "INSERT INTO lead_notes (lead_id, note, kind, user_id, author) VALUES ($1,$2,'followup',$3,$4)",
        [lead.id, "Follow-up set for " + followup + ".", req.user.id, req.user.name]);
    }
    ok(res, { saved: true }, { message: "Saved." });
  } catch (e) { next(e); }
});

router.all("/leads/:id", (req, res) => fail(res, 404, "Lead not found."));

// ---------------------------------------------------------------- reviews
// What a rep collects in the field. It arrives unpublished: the office reads it
// in the admin panel under Customer reviews and decides whether it goes on the
// website.
router.get("/reviews", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, customer, company, city, state, machine, rating, comment,
              published, created_at
       FROM service_reviews WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
    const counts = (await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE published)::int AS published,
              count(*) FILTER (WHERE NOT published)::int AS pending
       FROM service_reviews WHERE user_id = $1`, [req.user.id])).rows[0];
    ok(res, rows, { counts });
  } catch (e) { next(e); }
});

router.post("/reviews", async (req, res, next) => {
  try {
    const b = req.body || {};
    const customer = (b.customer || "").trim();
    if (!customer) return fail(res, 400, "Whose review is this? Add the customer's name.");
    const rating = parseInt(b.rating, 10);
    if (!(rating >= 1 && rating <= 5)) return fail(res, 400, "Give a rating from 1 to 5.");
    const comment = (b.comment || "").trim();
    if (!comment) return fail(res, 400, "Add what the customer said.");

    const { rows } = await db.query(
      `INSERT INTO service_reviews
         (customer, company, city, state, machine, rating, comment, published, source, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,'app',$8) RETURNING id`,
      [customer, trim(b.company), trim(b.city), trim(b.state), trim(b.machine),
        rating, comment, req.user.id]);

    ok(res, { id: rows[0].id, published: false },
      { message: "Thank you — the office will read it and put it on the website." });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- errors
router.use((req, res) => fail(res, 404, "Unknown endpoint."));

router.use((err, req, res, next) => {
  console.error("[api-app]", err);
  if (res.headersSent) return next(err);
  fail(res, 500, "Something went wrong. Try again.");
});

module.exports = router;
