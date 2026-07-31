import { describe, expect, it } from "vitest";
import { encodeGovVisitPassQr, parseGovVisitPassQr } from "./govvisit-qr";
import { parseCodePayload } from "./mrz";

describe("GovVisit pass QR", () => {
  it("round-trips a versioned GovVisit pass", () => {
    const encoded = encodeGovVisitPassQr("GV-ABJ-2026-0042");
    expect(parseGovVisitPassQr(encoded)).toEqual({
      type: "govvisit-pass",
      version: 1,
      passCode: "GV-ABJ-2026-0042",
    });
  });

  it.each([
    "OKORO|CHINEDU|A12345678",
    "https://example.com",
    "0123456789012",
    '{"firstName":"Ada","lastName":"Okoro","documentNumber":"123"}',
    '{"type":"govvisit-pass","version":2,"passCode":"GV-ABJ-2026-0042"}',
    '{"type":"govvisit-pass","version":1,"passCode":"not-a-pass"}',
  ])("rejects unsupported payload %s", (payload) => {
    expect(parseGovVisitPassQr(payload)).toBeNull();
    expect(parseCodePayload(payload)).toBeNull();
  });
});
