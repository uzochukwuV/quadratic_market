import { createRequire } from "node:module";
import path from "node:path";

process.env.NODE_ENV = "production";

const require = createRequire(path.join(process.cwd(), "index.js"));
require("./standalone/server.js");
