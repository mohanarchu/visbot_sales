// The service helpline details shown on the website's Service page, editable
// from the admin panel. Stored in the same key/value `settings` table the Meta
// integration uses, so no new schema is needed.
//
// Every field falls back to a sensible default, so the page is never left with
// a blank helpline if a row is missing or cleared.
const db = require("./db");

const KEYS = ["service_helpline", "service_technical", "service_hours"];

const DEFAULTS = {
  service_helpline: "+91 80723 98966",
  service_technical: "+91 99405 89366",
  service_hours: "Monday to Saturday, 9.30 am to 6.30 pm",
};

const LABELS = {
  service_helpline: "Service helpline number",
  service_technical: "Technical support number",
  service_hours: "Working hours",
};

async function get() {
  const out = { ...DEFAULTS };
  try {
    const rows = (await db.query(
      "SELECT key, value FROM settings WHERE key = ANY($1)", [KEYS])).rows;
    for (const r of rows) if (r.value && r.value.trim()) out[r.key] = r.value.trim();
  } catch {
    // A missing settings table must not take the Service page down.
  }
  return out;
}

async function set(values) {
  for (const key of KEYS) {
    if (!(key in values)) continue;
    const v = typeof values[key] === "string" ? values[key].trim() : "";
    if (!v) {
      // Cleared means "use the default again", not "show nothing".
      await db.query("DELETE FROM settings WHERE key=$1", [key]);
    } else {
      await db.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, v.slice(0, 160)]);
    }
  }
}

// Digits only, for a tel: link.
const dial = (s) => String(s || "").replace(/[^\d+]/g, "");

module.exports = { KEYS, DEFAULTS, LABELS, get, set, dial };
