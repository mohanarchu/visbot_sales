// States and union territories, and which of them a sales person covers.
//
// The list itself lives in the database (schema-states.sql) rather than here,
// because a lead points at a row in it. Resolving the free text on a lead to
// one of these rows is done by a trigger, so every way of writing a lead —
// website form, mobile app, both panels, the public API, the Meta import —
// gets it without having to remember.
const db = require("./db");

const COLS = "id, name, code, kind, sort_order";

async function list() {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM states ORDER BY sort_order, name`);
  return rows;
}

// The list for a dropdown, with how many leads sit in each one. Used by the
// admin's lead filter, so an empty state can still be chosen but reads as 0.
async function listWithCounts() {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.code, s.kind, s.sort_order,
            (SELECT count(*) FROM leads l WHERE l.state_id = s.id)::int AS lead_count,
            (SELECT count(*) FROM user_states us WHERE us.state_id = s.id)::int AS user_count
       FROM states s ORDER BY s.sort_order, s.name`);
  return rows;
}

async function forUser(userId) {
  if (!userId) return [];
  const { rows } = await db.query(
    `SELECT s.${COLS.split(", ").join(", s.")}
       FROM user_states us JOIN states s ON s.id = us.state_id
      WHERE us.user_id = $1
      ORDER BY s.sort_order, s.name`, [userId]);
  return rows;
}

// Everyone's states in one query, so a list of users does not make one call
// each. Returns { [userId]: [{id, name, code}] }.
async function forUsers(userIds) {
  if (!userIds || !userIds.length) return {};
  const { rows } = await db.query(
    `SELECT us.user_id, s.id, s.name, s.code
       FROM user_states us JOIN states s ON s.id = us.state_id
      WHERE us.user_id = ANY($1::int[])
      ORDER BY s.sort_order, s.name`, [userIds]);
  return rows.reduce((acc, r) => {
    (acc[r.user_id] = acc[r.user_id] || []).push({ id: r.id, name: r.name, code: r.code });
    return acc;
  }, {});
}

// Whatever arrived in a request body, as a clean list of ids.
function idsFrom(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === "string" && raw.trim() !== "" ? raw.split(",") : []);
  const ids = [];
  for (const v of list) {
    const n = Number(String(v).trim());
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids;
}

// Replaces a person's states with exactly this set. Ids that do not exist are
// dropped rather than failing the save; the caller is told how many took.
async function setForUser(userId, stateIds) {
  const ids = idsFrom(stateIds);
  if (!ids.length) {
    await db.query("DELETE FROM user_states WHERE user_id = $1", [userId]);
    return [];
  }
  const { rows } = await db.query(
    "SELECT id FROM states WHERE id = ANY($1::int[])", [ids]);
  const real = rows.map((r) => r.id);

  await db.query(
    "DELETE FROM user_states WHERE user_id = $1 AND NOT (state_id = ANY($2::int[]))",
    [userId, real.length ? real : [0]]);
  if (real.length) {
    await db.query(
      `INSERT INTO user_states (user_id, state_id)
       SELECT $1, x FROM unnest($2::int[]) AS x
       ON CONFLICT DO NOTHING`, [userId, real]);
  }
  return real;
}

// One state by id, name, code or any spelling of it — the same matching the
// trigger uses, so the admin and the database never disagree.
async function resolve(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const { rows } = await db.query(`SELECT ${COLS} FROM states WHERE id = $1`, [raw]);
    return rows[0] || null;
  }
  const { rows } = await db.query(
    `SELECT ${COLS} FROM states WHERE id = state_id_for($1)`, [raw]);
  return rows[0] || null;
}

module.exports = { list, listWithCounts, forUser, forUsers, setForUser, idsFrom, resolve };
