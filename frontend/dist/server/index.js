import { createRequire } from "node:module";
import http from "node:http";

process.env.NODE_ENV = "production";

const require = createRequire(`${process.cwd()}/.next/standalone/package.json`);
const next = require("next");

const port = Number(process.env.PORT || process.env.npm_config_port || 3000);
const app = next({ dev: false, dir: process.cwd() });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http
    .createServer((req, res) => {
      handle(req, res);
    })
    .listen(port, "0.0.0.0", () => {
      console.log(`Frontend listening on port ${port}`);
    });
});
