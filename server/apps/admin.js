// Admin panel — port 9002, served at admin.visbot.in.
//
// The panel is a single-page app (admin-app/) talking to the JSON API at
// /api/admin. The original server-rendered pages are still mounted at /admin
// as a fallback, so the panel stays reachable if JavaScript is unavailable.
require("dotenv").config({ path: __dirname + "/../.env" });
const path = require("path");
const express = require("express");
const session = require("express-session");
const { ROOT, configureViews, trustProxy, isProd } = require("../shared");

const SPA_DIR = path.join(ROOT, "admin-app");

function createAdminApp() {
  const app = express();
  trustProxy(app);
  configureViews(app);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use(
    session({
      name: "visbot.sid",
      secret: process.env.SESSION_SECRET || "visbot",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd(),
        maxAge: 1000 * 60 * 60 * 12,
      },
    })
  );

  // Asset directories the panel references.
  app.use("/css", express.static(path.join(ROOT, "css")));
  app.use("/js", express.static(path.join(ROOT, "js")));
  app.use("/assets", express.static(path.join(ROOT, "assets")));

  // The single-page app's own code.
  app.use("/ui", express.static(SPA_DIR, {
    setHeaders: (res, file) => {
      // Keep the shell fresh so a deploy is picked up; modules are revalidated.
      res.setHeader("Cache-Control", /\.(js|css)$/.test(file) ? "public, max-age=0, must-revalidate" : "public, max-age=300");
    },
  }));

  // JSON API behind the panel.
  app.use("/api/admin", require("../routes/admin-api"));

  // Server-rendered fallback.
  app.use("/admin", require("../routes/admin"));

  // Everything else is a client-side route: serve the shell and let the router
  // decide. Unknown /api paths must still 404 as JSON.
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: { message: "Unknown endpoint." } });
    }
    res.sendFile(path.join(SPA_DIR, "index.html"));
  });

  return app;
}

module.exports = { createAdminApp };
