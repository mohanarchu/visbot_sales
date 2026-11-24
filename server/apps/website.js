// Public website — port 9000, served at visbot.in.
// Renders the catalogue pages from PostgreSQL and serves the static assets.
require("dotenv").config({ path: __dirname + "/../.env" });
const express = require("express");
const { ROOT, configureViews, trustProxy } = require("../shared");

function createWebsiteApp() {
  const app = express();
  trustProxy(app);
  configureViews(app);
  app.use(express.urlencoded({ extended: true }));

  // In production nginx sends /api/ straight to the backend. This forwarder is
  // the fallback for anything that reaches the website app directly (local
  // development, or a direct hit on port 9000).
  const backendOrigin = process.env.BACKEND_ORIGIN || "http://127.0.0.1:" + (process.env.BACKEND_PORT || 9001);
  const forward = (path) => async (req, res) => {
    try {
      const r = await fetch(backendOrigin + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Forwarded-For": req.ip,
        },
        body: new URLSearchParams(req.body).toString(),
        signal: AbortSignal.timeout(8000),
      });
      res.status(r.status).json(await r.json().catch(() => ({ ok: r.ok })));
    } catch (e) {
      console.error("forward to " + path + " failed:", e.message);
      res.status(502).json({ ok: false });
    }
  };
  app.post("/api/enquiry", forward("/api/enquiry"));
  app.post("/api/service", forward("/api/service"));

  // Database-backed pages first, so they shadow the old static .html files.
  app.use("/", require("../routes/public"));
  app.use(express.static(ROOT));

  return app;
}

module.exports = { createWebsiteApp };
