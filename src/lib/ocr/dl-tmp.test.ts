import { test, expect } from "vitest";
import { parseNigerianId } from "@/lib/ocr/nigerian-id-parser";
test("frsc numbered", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nDRIVER'S LICENCE\n1. BELLO\n2. MUSA ADAMU\n3. 01-01-1980 KANO\n5. ABC12345AA01`);
  console.log(r);
  expect(r.firstName).toBe("Musa Adamu");
  expect(r.lastName).toBe("Bello");
});
test("combined line", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nFRSC DRIVER'S LICENCE\nBELLO, MUSA\nLICENCE NO: ABC12345AA01`);
  console.log(r);
  expect(r.lastName).toBe("Bello");
  expect(r.firstName).toBe("Musa");
});
test("surname only label", () => {
  const r = parseNigerianId(`FRSC DRIVER'S LICENCE\nSURNAME: BELLO\nMUSA ADAMU\nLICENCE NO: ABC12345AA01`);
  console.log(r);
  expect(r.lastName).toBe("Bello");
  expect(r.firstName).toBe("Musa Adamu");
});
