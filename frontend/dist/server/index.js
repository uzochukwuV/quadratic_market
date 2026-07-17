import { createRequire } from "node:module";

process.env.NODE_ENV = "production";

const require = createRequire(import.meta.url);
require("../../.next/standalone/server.js");
