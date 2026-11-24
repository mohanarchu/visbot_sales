const { createWebsiteApp } = require("../apps/website");
const { PORTS, listen } = require("../shared");
listen(createWebsiteApp(), PORTS.website(), "website");
