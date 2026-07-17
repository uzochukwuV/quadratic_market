import { createRequire } from "node:module";
import path from "node:path";

process.env.NODE_ENV = "production";

const standaloneDir = path.join(process.cwd(), ".next/standalone");
const require = createRequire(path.join(standaloneDir, "package.json"));
require(path.join(standaloneDir, "server.js"));
