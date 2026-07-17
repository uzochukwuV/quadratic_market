const path = require("path");

process.env.NODE_ENV = "production";
process.chdir(__dirname);

require(path.join(__dirname, "standalone/server.js"));
