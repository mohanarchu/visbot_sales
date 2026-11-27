// The people who refer business, and what their referrals are worth.
//
// Mounted under /api/admin/referrers, so the parent router's session check has
// already run by the time anything here is reached.
const router = require("express").Router();
const db = require("../db");
const R = require("../referrals");
const { pageOf, countOf } = require("../paging");
const { trim } = require("../admin-util");

const ok = (res, data, extra) => res.json(Object.assign({ data }, extra || {}));
const fail = (res, code, message) => res.status(code).json({ error: { message } });

// What each referrer has brought in. The flat total is money already agreed, so
// it adds up; percentage fees cannot become rupees until an order value is
// recorded against the lead, so they are counted, not summed.
const STATS = `
  (SELECT count(*) FROM leads l WHERE l.referrer_id = r.id)::int AS lead_count,
  (SELECT count(*) FROM leads l WHERE l.referrer_id = r.id
     AND l.status = 'won')::int AS won_count,
  (SELECT count(*) FROM leads l WHERE l.referrer_id = r.id
     AND l.status NOT IN ('won', 'lost'))::int AS open_count,
  COALESCE((SELECT sum(l.referral_value) FROM leads l
     WHERE l.referrer_id = r.id AND l.status = 'won'
       AND l.referral_kind = 'flat'), 0)::float8 AS flat_won_total,
  COALESCE((SELECT sum(l.referral_value) FROM leads l
     WHERE l.referrer_id = r.id AND l.referral_kind = 'flat'), 0)::float8 AS flat_all_total,
  (SELECT count(*) FROM leads l WHERE l.referrer_id = r.id
     AND l.referral_kind = 'percent')::int AS percent_count`;

router.get("/", async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const q = trim(req.query.q);
    if (q) {
      params.push("%" + q + "%");
      where.push(`(r.name ILIKE $${params.length} OR r.phone ILIKE $${params.length}
                   OR r.email ILIKE $${params.length})`);
    }
    if (req.query.active === "1") where.push("r.active");
    if (req.query.active === "0") where.push("NOT r.active");
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";

    const p = pageOf(req, await countOf(
      `SELECT count(*) FROM referrers r ${clause}`, params));

    const rows = (await db.query(
      `SELECT r.*, ${STATS} FROM referrers r ${clause}
       ORDER BY r.active DESC, r.name ${p.sql}`, params)).rows;

    const totals = (await db.query(
      `SELECT count(*)::int AS referrers,
              (SELECT count(*) FROM leads WHERE referrer_id IS NOT NULL)::int AS referred_leads,
              (SELECT count(*) FROM leads
                 WHERE referrer_id IS NOT NULL AND status = 'won')::int AS won_leads,
              COALESCE((SELECT sum(referral_value) FROM leads
                 WHERE status = 'won' AND referral_kind = 'flat'), 0)::float8 AS flat_won_total
       FROM referrers`)).rows[0];

    ok(res, rows, { meta: p.meta, totals, kinds: R.KINDS });
  } catch (e) { next(e); }
});

// Just enough to offer referrers by name while a lead is being typed in.
//
// Three columns and no per-referrer counts, because this is fetched to fill a
// dropdown rather than to be read. Switched-off referrers are left out: the
// point of switching one off is to stop offering them on new leads.
//
// Capped, so one query cannot pull an unbounded table into the browser. The
// panel filters the list as you type, which is instant and needs no request
// per keystroke; past the cap that would have to become a server-side search.
router.get("/suggest", async (req, res, next) => {
  try {
    const rows = (await db.query(
      `SELECT id, name, phone FROM referrers WHERE active ORDER BY name LIMIT 1000`)).rows;
    ok(res, rows, { capped: rows.length === 1000 });
  } catch (e) { next(e); }
});

router.get("/:id(\\d+)", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT r.*, ${STATS} FROM referrers r WHERE r.id = $1`, [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Referrer not found.");

    // Their leads, newest first, with what each one is worth.
    const leads = (await db.query(
      `SELECT l.id, l.name, l.phone, l.company, l.city, l.status, l.priority,
              l.referral_kind, l.referral_value, l.created_at, l.owner
       FROM leads l WHERE l.referrer_id = $1
       ORDER BY l.created_at DESC, l.id DESC`, [req.params.id])).rows;

    ok(res, { referrer: r.rows[0], leads }, { kinds: R.KINDS });
  } catch (e) { next(e); }
});

function values(b) {
  return [trim(b.name), trim(b.phone) || null, trim(b.email) || null,
          trim(b.notes) || null, b.active === "" ? false : b.active !== "off"];
}

// A mobile number already on file belongs to somebody; two rows for one person
// would split their leads in two, which is what the unique index prevents.
async function clash(phone, name, exceptId) {
  const key = R.phoneKey(phone);
  const r = await db.query(
    `SELECT id, name FROM referrers
      WHERE id <> $3
        AND CASE WHEN $1 <> ''
              THEN right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
              ELSE lower(btrim(name)) = lower(btrim($2)) AND coalesce(phone, '') = ''
             END
      LIMIT 1`, [key, name, exceptId || 0]);
  return r.rows[0] || null;
}

router.post("/", async (req, res, next) => {
  try {
    const v = values(req.body);
    if (!v[0]) return fail(res, 400, "A referrer needs a name.");
    const dup = await clash(req.body.phone, v[0], 0);
    if (dup) return fail(res, 409, `That number is already on file as “${dup.name}”.`);
    const r = await db.query(
      `INSERT INTO referrers (name, phone, email, notes, active)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`, v);
    ok(res, { id: r.rows[0].id }, { message: `Referrer “${v[0]}” added.` });
  } catch (e) { next(e); }
});

router.put("/:id(\\d+)", async (req, res, next) => {
  try {
    const v = values(req.body);
    if (!v[0]) return fail(res, 400, "A referrer needs a name.");
    const dup = await clash(req.body.phone, v[0], Number(req.params.id));
    if (dup) return fail(res, 409, `That number is already on file as “${dup.name}”.`);
    const r = await db.query(
      `UPDATE referrers SET name=$1, phone=$2, email=$3, notes=$4, active=$5,
         updated_at=now() WHERE id=$6 RETURNING id`, [...v, req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Referrer not found.");
    ok(res, { id: r.rows[0].id }, { message: `Referrer “${v[0]}” saved.` });
  } catch (e) { next(e); }
});

router.delete("/:id(\\d+)", async (req, res, next) => {
  try {
    const n = await countOf(
      "SELECT count(*) FROM leads WHERE referrer_id = $1", [req.params.id]);
    // Removing the row would strip the referrer off leads that record a
    // commission, leaving a fee owed to nobody. Switching them off instead
    // keeps the history and stops them appearing on new leads.
    if (n > 0) {
      return fail(res, 409,
        `This referrer is named on ${n} lead${n === 1 ? "" : "s"}, so removing them would ` +
        `leave those referral fees owed to nobody. Switch them off instead.`);
    }
    const r = await db.query(
      "DELETE FROM referrers WHERE id=$1 RETURNING name", [req.params.id]);
    if (!r.rows.length) return fail(res, 404, "Referrer not found.");
    ok(res, { deleted: true }, { message: `Referrer “${r.rows[0].name}” removed.` });
  } catch (e) { next(e); }
});

module.exports = router;
