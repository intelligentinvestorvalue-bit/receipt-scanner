import { describe, expect, it, afterEach } from "vitest";
import { assertSetupSecret, SetupAuthError } from "@/lib/setup-month";

describe("assertSetupSecret", () => {
  const original = process.env.SETUP_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.SETUP_SECRET;
    else process.env.SETUP_SECRET = original;
  });

  it("fails closed when SETUP_SECRET is unset", () => {
    delete process.env.SETUP_SECRET;
    expect(() => assertSetupSecret("anything")).toThrow(SetupAuthError);
  });

  it("rejects missing or wrong secret when configured", () => {
    process.env.SETUP_SECRET = "correct-secret";
    expect(() => assertSetupSecret(null)).toThrow(SetupAuthError);
    expect(() => assertSetupSecret("wrong")).toThrow(SetupAuthError);
  });

  it("accepts matching secret", () => {
    process.env.SETUP_SECRET = "correct-secret";
    expect(() => assertSetupSecret("correct-secret")).not.toThrow();
  });
});
