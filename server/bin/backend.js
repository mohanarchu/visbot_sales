const { createBackendApp } = require("../apps/backend");
const { PORTS, listen } = require("../shared");
listen(createBackendApp(), PORTS.backend(), "backend");
