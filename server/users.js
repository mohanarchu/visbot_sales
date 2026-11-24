// Panel users, roles and sign-in. Shared by the admin panel (cookie session)
// and the sales mobile app (bearer token), so the rules live in one place.
const crypto = require("crypto");
const { promisify } = require("util");
const db = require("./db");

const scrypt = promisify(crypto.scrypt);

// ---------------------------------------------------------------- roles
const ROLES = [
  { key: "admin", label: "Admin",
    blurb: "Everything in the panel, including adding and removing users." },
  { key: "manager", label: "Manager",
    blurb: "Everything except user management." },
  { key: "sales", label: "Sales",
    blurb: "Their own leads and customer reviews, through the mobile app." },
];

// What each role may reach. `leads` is a scope, not a yes/no: "own" means a user
// only ever sees the leads assigned to them.
//   web      can sign in to admin.visbot.in
//   app      can sign in to the sales mobile app
const PERMS = {
  admin:   { web: true,  app: true,  users: true,  leads: "all", service: true,  content: true,  reviews: true },
  manager: { web: true,  app: true,  users: false, leads: "all", service: true,  content: true,  reviews: true },
  sales:   { web: false, app: true,  users: false, leads: "own", service: false, content: false, reviews: true },
};

// An unknown role (a hand-edited database row, or one left behind by an older
// version) gets the narrowest set rather than the widest.
const perms = (role) => PERMS[role] || PERMS.sales;
const can = (role, area) => perms(role)[area] === true;
const leadScope = (role) => perms(role).leads;
const isRole = (key) => ROLES.some((r) => r.key === key);
const roleLabel = (key) => (ROLES.find((r) => r.key === key) || { label: key }).label;

// ---------------------------------------------------------------- passwords
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MIN_PASSWORD = 8;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, SCRYPT.keylen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString("base64"), key.toString("base64")].join("$");
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, key] = parts;
  const expected = Buffer.from(key, "base64");
  let actual;
  try {
    actual = await scrypt(String(password), Buffer.from(salt, "base64"), expected.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  } catch { return false; }
  // Equal lengths are guaranteed by asking scrypt for expected.length bytes.
  return crypto.timingSafeEqual(actual, expected);
}

// Why a password was refused, or null when it is fine.
function passwordProblem(password) {
  const pw = String(password == null ? "" : password);
  if (pw.length < MIN_PASSWORD) return `The password must be at least ${MIN_PASSWORD} characters.`;
  if (/^\s|\s$/.test(pw)) return "The password cannot start or end with a space.";
  if (pw.length > 200) return "That password is too long.";
  return null;
}

// ---------------------------------------------------------------- how to sign in
// There is no username: a person types their mobile number or their email
// address. A number is matched on its last ten digits, so the spacing, a
// leading zero and the +91 all stop mattering.
const phoneKey = (phone) => {
  const digits = String(phone == null ? "" : phone).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const normalEmail = (email) => String(email == null ? "" : email).trim().toLowerCase();

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());

// Why a way of signing in was refused, or null when it is fine.
function contactProblem({ email, phone }) {
  const hasEmail = String(email || "").trim() !== "";
  const hasPhone = String(phone || "").trim() !== "";
  if (!hasEmail && !hasPhone) {
    return "Add a mobile number or an email address — it is what they sign in with.";
  }
  if (hasEmail && !looksLikeEmail(email)) {
    return "That does not look like an email address.";
  }
  if (hasPhone) {
    const key = phoneKey(phone);
    if (key.length !== 10) {
      return "A mobile number needs 10 digits, with or without +91.";
    }
    if (!/^[6-9]/.test(key)) {
      return "That does not look like an Indian mobile number.";
    }
  }
  // The .env administrator is matched before the database, so a row reachable
  // by the same thing would be shadowed by it and never usable.
  const env = envAdminName();
  if ((hasEmail && normalEmail(email) === normalEmail(env))
      || (hasPhone && phoneKey(phone) === phoneKey(env) && phoneKey(env).length === 10)) {
    return `That is the built-in administrator from the server configuration. Use a different number or address.`;
  }
  return null;
}

// How this person signs in, for showing back to them.
const loginId = (u) => (u ? (u.phone || u.email || "") : "");

// ---------------------------------------------------------------- the env admin
// The panel shipped with one account in the .env file, and it stays usable so a
// misconfigured users table can never lock everyone out. It is web-only: it has
// no row in the database, so nothing can be assigned to it.
function envAdminName() { return process.env.ADMIN_USER || "admin"; }

function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a == null ? "" : a)).digest();
  const hb = crypto.createHash("sha256").update(String(b == null ? "" : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verifyEnvAdmin(identifier, password) {
  return sameSecret(identifier, envAdminName())
    && sameSecret(password, process.env.ADMIN_PASSWORD || "visbot@123");
}

const ENV_ADMIN = () => ({
  id: null,
  name: "Administrator",
  email: null,
  phone: null,
  role: "admin",
  active: true,
  must_change_password: false,
  env: true,
  login_id: envAdminName(),
});

// ---------------------------------------------------------------- queries
const COLS = `id, name, email, phone, phone_key, role, active, must_change_password,
              created_at, updated_at, last_login_at, last_app_login_at`;

// What leaves the server: never the hash.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email || null,
    phone: u.phone || null,
    // What this person types to sign in.
    login_id: u.env ? u.login_id : loginId(u),
    role: u.role,
    role_label: roleLabel(u.role),
    active: u.active !== false,
    must_change_password: !!u.must_change_password,
    env: !!u.env,
    created_at: u.created_at || null,
    last_login_at: u.last_login_at || null,
    last_app_login_at: u.last_app_login_at || null,
    can: perms(u.role),
  };
}

// Finds whoever signs in with this mobile number or email address. One query
// covers both, so the caller does not have to guess which was typed.
async function findByLogin(identifier) {
  const raw = String(identifier == null ? "" : identifier).trim();
  if (!raw) return null;
  const email = normalEmail(raw);
  const key = phoneKey(raw);
  const { rows } = await db.query(
    `SELECT ${COLS}, password_hash FROM users
     WHERE (coalesce(email, '') <> '' AND lower(email) = $1)
        OR ($2 <> '' AND phone_key = $2)
     LIMIT 1`, [email, key.length === 10 ? key : ""]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Just the stored hash, for checking a password somebody has typed again.
async function hashFor(id) {
  const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [id]);
  return rows.length ? rows[0].password_hash : null;
}

async function list({ q = "", role = "", active = "" } = {}) {
  const where = [];
  const vals = [];
  if (q) {
    vals.push(`%${q}%`);
    where.push(`(name ILIKE $${vals.length} OR email ILIKE $${vals.length}
                 OR phone ILIKE $${vals.length} OR phone_key ILIKE $${vals.length})`);
  }
  if (role) { vals.push(role); where.push(`role = $${vals.length}`); }
  if (active === "1" || active === "0") where.push(`active = ${active === "1"}`);
  const { rows } = await db.query(
    `SELECT ${COLS} FROM users
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY active DESC, name`, vals);
  return rows;
}

// Everyone who can be given a lead.
async function assignable() {
  const { rows } = await db.query(
    `SELECT id, name, role FROM users WHERE active ORDER BY name`);
  return rows;
}

async function countAdmins(exceptId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM users
     WHERE role = 'admin' AND active AND ($1::int IS NULL OR id <> $1)`, [exceptId || null]);
  return rows[0].n;
}

async function create({ name, email, phone, role, password, must_change_password }) {
  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, phone_key, role, password_hash, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
    [name, email || null, phone || null, phoneKey(phone) || null, role, hash,
      !!must_change_password]);
  return rows[0];
}

async function update(id, { name, email, phone, role, active }) {
  const { rows } = await db.query(
    `UPDATE users SET name=$2, email=$3, phone=$4, phone_key=$5, role=$6, active=$7,
            updated_at=now()
     WHERE id=$1 RETURNING ${COLS}`,
    [id, name, email || null, phone || null, phoneKey(phone) || null, role,
      active !== false]);
  return rows[0] || null;
}

async function setPassword(id, password, { mustChange = false } = {}) {
  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `UPDATE users SET password_hash=$2, must_change_password=$3, updated_at=now()
     WHERE id=$1 RETURNING ${COLS}`, [id, hash, !!mustChange]);
  // Every phone holding a token for this account has to sign in again. A web
  // session already open is not tracked per user, so it lasts until it expires.
  await db.query("DELETE FROM user_tokens WHERE user_id = $1", [id]);
  return rows[0] || null;
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
}

async function touchLogin(id, { app = false } = {}) {
  if (!id) return;
  await db.query(
    `UPDATE users SET last_login_at = now()${app ? ", last_app_login_at = now()" : ""} WHERE id = $1`,
    [id]);
}

// ---------------------------------------------------------------- app tokens
const TOKEN_DAYS = 60;
const tokenHash = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

async function issueToken(userId, device) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO user_tokens (user_id, token_hash, device, last_used_at, expires_at)
     VALUES ($1, $2, $3, now(), now() + ($4 || ' days')::interval)`,
    [userId, tokenHash(raw), String(device || "").slice(0, 120) || null, String(TOKEN_DAYS)]);
  await db.query("DELETE FROM user_tokens WHERE expires_at < now()");
  return { token: raw, days: TOKEN_DAYS };
}

// Returns the signed-in user, or null. Each use slides the expiry forward, so an
// app in regular use never asks for the password again.
async function userForToken(raw) {
  if (!raw) return null;
  const { rows } = await db.query(
    `UPDATE user_tokens SET last_used_at = now(),
            expires_at = now() + ($2 || ' days')::interval
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING user_id`, [tokenHash(raw), String(TOKEN_DAYS)]);
  if (!rows.length) return null;
  const user = await findById(rows[0].user_id);
  if (!user || user.active === false) return null;
  return user;
}

async function revokeToken(raw) {
  if (!raw) return false;
  const { rowCount } = await db.query("DELETE FROM user_tokens WHERE token_hash = $1", [tokenHash(raw)]);
  return rowCount > 0;
}

async function revokeAllForUser(id) {
  await db.query("DELETE FROM user_tokens WHERE user_id = $1", [id]);
}

// Has anyone been created yet? Decides whether the first-run admin is seeded.
async function anyUsers() {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM users");
  return rows[0].n > 0;
}

module.exports = {
  ROLES, PERMS, MIN_PASSWORD, TOKEN_DAYS,
  perms, can, leadScope, isRole, roleLabel,
  hashPassword, verifyPassword, passwordProblem,
  phoneKey, normalEmail, looksLikeEmail, contactProblem, loginId,
  envAdminName, verifyEnvAdmin, ENV_ADMIN,
  publicUser, findByLogin, findById, hashFor, list, assignable, countAdmins,
  create, update, setPassword, remove, touchLogin, anyUsers,
  issueToken, userForToken, revokeToken, revokeAllForUser,
};
