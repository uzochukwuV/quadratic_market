import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "production";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
process.chdir(projectRoot);

await import(new URL("../../.next/standalone/server.js", import.meta.url));
