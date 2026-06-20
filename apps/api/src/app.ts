/**
 * PLACEHOLDER API entrypoint owned by DevOps only to (a) give the container a real
 * healthcheck target and (b) give CI something to build + test. BE replaces/extends this
 * with the real routes, auth, branch-scoping middleware, and service layer (P1-*).
 * Keep the `/api/v1/health` contract — the Docker HEALTHCHECK and Uptime Robot use it.
 */
import Fastify, { FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "marinex360-api",
    time: new Date().toISOString(),
  }));

  return app;
}
