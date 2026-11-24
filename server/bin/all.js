// Local development convenience: run all three apps in one process, each on
// its own port, exactly as they run on the server.
const { createWebsiteApp } = require("../apps/website");
const { createBackendApp } = require("../apps/backend");
const { createAdminApp } = require("../apps/admin");
const { PORTS, listen } = require("../shared");

listen(createWebsiteApp(), PORTS.website(), "website");
listen(createBackendApp(), PORTS.backend(), "backend");
listen(createAdminApp(), PORTS.admin(), "admin");
