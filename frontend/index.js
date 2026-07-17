import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

process.env.NODE_ENV = "production";

const require = createRequire(path.join(process.cwd(), "index.js"));
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
