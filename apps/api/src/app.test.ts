import { describe, it, expect } from "vitest";
import { buildApp } from "./app.js";

describe("health route", () => {
  it("returns ok", async () => {
    const app = buildApp({
      prisma: {} as any,
      accessSecret: "test-secret",
      presignPut: async () => ({ uploadUrl: "http://test.local/x" }),
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    await app.close();
  });
});