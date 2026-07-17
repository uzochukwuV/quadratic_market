import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

process.env.NODE_ENV = "production";

const require = createRequire(path.join(process.cwd(), "index.js"));
const { startServer } = require("next/dist/server/lib/start-server");
const requiredServerFiles = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), ".next/required-server-files.json"), "utf8")
);
const nextConfig = requiredServerFiles.config;

const dir = process.cwd();
const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined;
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
