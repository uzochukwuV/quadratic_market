const next = require("next");
const http = require("http");

const port = Number(process.env.PORT || process.env.npm_config_port || 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: __dirname });
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
