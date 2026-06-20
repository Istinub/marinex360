import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.API_PORT ?? 3000);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`marinex360-api listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
