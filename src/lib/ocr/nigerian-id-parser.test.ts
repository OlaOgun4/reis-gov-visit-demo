import { test, expect } from "vitest";
import { parseNigerianId } from "@/lib/ocr/nigerian-id-parser";
test("nin", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nNATIONAL IDENTITY MANAGEMENT COMMISSION\nSURNAME\nOKAFOR\nFIRST NAME\nADEBAYO\nNATIONAL IDENTIFICATION NUMBER\n1234 5678 901\nTRACKING ID: WXY123456`);
  console.log(r);
  expect(r.documentType).toBe("Nigerian NIN");
  expect(r.documentNumber).toBe("12345678901");
  expect(r.firstName).toBe("Adebayo");
  expect(r.lastName).toBe("Okafor");
});
test("passport", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nPASSPORT\nSURNAME OKORO\nGIVEN NAMES CHINEDU\nPASSPORT NO A01234567\nP<NGAOKORO<<CHINEDU<<<<<<<<<<<<<<<<<<<<<<<<<\nA012345671NGA8001019M3001011<<<<<<<<<<<<<<04`);
  console.log(r);
  expect(r.documentType).toBe("Nigerian Passport");
  expect(r.firstName).toBe("Chinedu");
  expect(r.documentNumber).toMatch(/A0123456/);
});
test("licence", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nFRSC DRIVER'S LICENCE\nSURNAME: BELLO\nFIRST NAME: MUSA\nLICENCE NO: ABC12345AA01`);
  console.log(r);
  expect(r.documentType).toBe("Nigerian Driver's Licence");
  expect(r.documentNumber).toBe("ABC12345AA01");
  expect(r.lastName).toBe("Bello");
});
