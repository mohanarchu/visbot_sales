const { createAdminApp } = require("../apps/admin");
const { PORTS, listen } = require("../shared");
listen(createAdminApp(), PORTS.admin(), "admin");
