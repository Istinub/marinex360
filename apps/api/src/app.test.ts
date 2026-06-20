import { describe, it, expect } from "vitest";
import { buildApp } from "./app.js";

describe("health route", () => {
  it("returns ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "marinex360-api" });
    await app.close();
  });
});
