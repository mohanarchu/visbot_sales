// Wiring common to all three apps (website, backend, admin).
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Everything the EJS views expect to find as a global helper.
function applyLocals(app) {
  app.locals.icon = require("./icons").icon;
  Object.assign(app.locals, require("./format"));
  app.locals.LEAD = require("./leads-meta");
  app.locals.mask = require("./meta").mask;
}

function configureViews(app) {
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  applyLocals(app);
}

// Behind nginx, so Express must read X-Forwarded-* to know the real protocol
// and client IP (needed for secure cookies and for enquiry rate limiting).
function trustProxy(app) {
  app.set("trust proxy", 1);
}

const isProd = () => process.env.NODE_ENV === "production";

const num = (v, fallback) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);

const PORTS = {
  website: () => num(process.env.WEBSITE_PORT, 9000),
  backend: () => num(process.env.BACKEND_PORT, 9001),
  admin: () => num(process.env.ADMIN_PORT, 9002),
};

function listen(app, port, label) {
  return app.listen(port, () => {
    console.log(`[visbot ${label}] listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { ROOT, configureViews, applyLocals, trustProxy, isProd, PORTS, listen, num };
