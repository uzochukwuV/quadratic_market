import { createRequire } from "node:module";

process.env.NODE_ENV = "production";

const require = createRequire(`${process.cwd()}/.next/standalone/package.json`);
require("./server.js");
