require("dotenv").config({ path: __dirname + "/.env" });
const { Pool, types } = require("pg");

// A DATE column is a calendar day, not an instant. Left as a JS Date it becomes
// local midnight, and JSON.stringify then writes it through toISOString(),
// which moves it to the previous day for any timezone ahead of UTC — so a
// follow-up set for the 25th came back to clients as the 24th. Keeping the raw
// "YYYY-MM-DD" string removes that whole class of off-by-one bugs.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost/visbot",
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
