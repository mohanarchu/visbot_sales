// Referral leads: who sent them, and what that is worth.
//
// A referral names a person, not a text field. The name and mobile typed into
// the lead form are resolved to a row in `referrers`, reusing the existing row
// when that person has sent business before, so one referrer's leads can be
// counted together.
const db = require("./db");

const KINDS = [
  { key: "percent", label: "Percentage of the order" },
  { key: "flat",    label: "Flat amount" },
];
const isKind = (k) => KINDS.some((x) => x.key === k);

// The last ten digits, which is what makes two spellings of one Indian mobile
// number the same person. Matches how leads are matched elsewhere.
const phoneKey = (p) => String(p == null ? "" : p).replace(/\D/g, "").slice(-10);

const trim = (v) => (v == null ? "" : String(v).trim());

// Reads the referral part of a submitted lead form.
//
// `{ clear: true }` means the lead is not a referral and the referral columns
// must be emptied: a lead switched from "Referral" to "Phone call" should not
// go on quietly owing somebody a commission.
function parse(body) {
  if (body.source !== "referral") return { ok: true, clear: true };

  const name = trim(body.referrer_name);
  const phone = trim(body.referrer_phone);
  if (!name) {
    return { ok: false, message: "A referral needs the name of the person who referred it." };
  }

  const rawValue = trim(body.referral_value);
  const kind = isKind(body.referral_kind) ? body.referral_kind : "";

  // A number with nothing saying what it means is the one combination that
  // cannot be stored honestly, so it is refused rather than guessed at.
  if (rawValue !== "" && !kind) {
    return { ok: false, message: "Choose whether the referral fee is a percentage or a flat amount." };
  }
  if (kind && rawValue === "") {
    return {
      ok: false,
      message: kind === "percent"
        ? "Enter the referral percentage, or set the fee back to “Not agreed yet”."
        : "Enter the referral amount, or set the fee back to “Not agreed yet”.",
    };
  }

  let value = null;
  if (kind) {
    // Number() rather than parseFloat(): parseFloat("12abc") is 12, which would
    // store a figure nobody typed.
    value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return { ok: false, message: "The referral fee must be a number." };
    }
    if (value < 0) {
      return { ok: false, message: "A referral fee cannot be negative." };
    }
    if (kind === "percent" && value > 100) {
      return { ok: false, message: "A referral percentage cannot be more than 100%." };
    }
    value = Math.round(value * 100) / 100;
  }

  return { ok: true, name, phone, kind: kind || null, value };
}

// The referrer row for this name and mobile, creating it the first time.
async function resolve({ name, phone }) {
  const key = phoneKey(phone);
  const existing = async () => (await db.query(
    `SELECT id FROM referrers
      WHERE CASE WHEN $1 <> ''
             THEN right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
             ELSE lower(btrim(name)) = lower(btrim($2)) AND coalesce(phone, '') = ''
            END
      LIMIT 1`, [key, name])).rows[0];

  const found = await existing();
  if (found) return found.id;

  // The name is left as first entered. Someone correcting a spelling here would
  // otherwise silently rename a referrer across every lead they ever sent; the
  // referrer's own page is where a name is changed.
  const made = await db.query(
    `INSERT INTO referrers (name, phone) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING id`, [name, phone || null]);
  if (made.rows.length) return made.rows[0].id;

  // Lost a race with another save; the unique index held, so read it back.
  const now = await existing();
  if (now) return now.id;
  throw new Error("Could not save the referrer.");
}

// What a lead's referral columns should become, referrer row included.
async function fieldsFor(body) {
  const p = parse(body);
  if (!p.ok) return p;
  if (p.clear) return { ok: true, referrer_id: null, kind: null, value: null };
  return {
    ok: true,
    referrer_id: await resolve({ name: p.name, phone: p.phone }),
    kind: p.kind,
    value: p.value,
  };
}

// "5%" or "₹2,500" — how a fee reads once saved.
function feeLabel(kind, value) {
  if (!kind || value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (kind === "percent") {
    return (Math.round(n * 100) / 100) + "%";
  }
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

module.exports = { KINDS, isKind, phoneKey, parse, resolve, fieldsFor, feeLabel };
