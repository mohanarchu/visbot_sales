// Backend API — port 9001, served at backend.visbot.in.
// Holds the enquiry capture endpoint and the Meta lead-ads webhook.
require("dotenv").config({ path: __dirname + "/../.env" });
const express = require("express");
const { configureViews, trustProxy } = require("../shared");

function createBackendApp() {
  const app = express();
  trustProxy(app);
  configureViews(app); // the webhook logs via the same helpers

  // The Meta webhook is mounted ahead of the body parsers: its signature is an
  // HMAC of the exact bytes Meta sent, so the raw body must stay untouched.
  app.use("/api/meta", require("../routes/meta-webhook"));

  // /api/v1 is a public read-mostly API for the website, the mobile app and any
  // other client, so it is open to all origins. Native apps ignore CORS, but a
  // web or hybrid build needs these headers.
  const siteOrigin = (process.env.SITE_URL || "https://visbot.in").replace(/\/$/, "");
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (req.path.startsWith("/api/v1")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
    } else if (req.path.startsWith("/api/app")) {
      // The sales app signs in with a bearer token and sends no cookies, so
      // there is nothing a hostile page could make a browser attach. Allowing
      // every origin only means a web or desktop build of the app also works.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Max-Age", "86400");
    } else if (origin && origin.replace(/\/$/, "") === siteOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use("/api/v1", require("../routes/api-v1"));
  app.use("/api/app", require("../routes/api-app"));
  app.use("/api", require("../routes/api"));

  app.get("/", (req, res) =>
    res.json({ service: "visbot-backend", ok: true, api: "/api/v1" }));

  return app;
}

module.exports = { createBackendApp };
