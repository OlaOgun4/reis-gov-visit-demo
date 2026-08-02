import { describe, expect, it } from "vitest";
import { registrationErrorMessage, registrationStageError } from "./registration";

describe("registration error reporting", () => {
  it("preserves ordinary Error messages", () => {
    expect(registrationErrorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
  });

  it("exposes structured Supabase errors", () => {
    expect(
      registrationErrorMessage({
        message: "new row violates row-level security policy",
        code: "42501",
      }),
    ).toBe("new row violates row-level security policy (code 42501)");
  });

  it("identifies the failed registration stage", () => {
    expect(registrationStageError("Creating visit", { message: "Insert failed" }).message).toBe(
      "Creating visit: Insert failed",
    );
  });
});
