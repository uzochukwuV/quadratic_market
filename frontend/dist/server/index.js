const path = require("path");

process.env.NODE_ENV = "production";
process.chdir(path.join(__dirname, "../.."));

require(path.join(__dirname, "../../.next/standalone/server.js"));
