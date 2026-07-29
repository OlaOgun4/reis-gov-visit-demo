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

test("licence without numbered markers", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nDRIVER'S LICENCE\nSURNAME\nADEYEMI\nGIVEN NAMES\nTUNDE OLA\nDATE OF BIRTH 01/01/1980\nLICENCE NO: ABC12345AA01`);
  expect(r.lastName).toBe("Adeyemi");
  expect(r.firstName).toBe("Tunde Ola");
});

test("licence with no labels at all", () => {
  const r = parseNigerianId(`FEDERAL REPUBLIC OF NIGERIA\nFRSC\nDRIVING LICENCE\nOGUNDE\nFEMI\n01/01/1980\nABC12345AA01`);
  expect(r.lastName).toBe("Ogunde");
  expect(r.firstName).toBe("Femi");
});

test("passport data page, labels lost by OCR", () => {
  const r = parseNigerianId(`SINR HERE\nSi NEN IE ee ey\nps)\n|< = Pl, 5\nFEDERAL REPUBLIC OF NIGERIA Passport / Passeport\n= ski\nP NGA 851496242 ~\npy 1\n" TEE ale\nrr\nNENGIMONYUN BUNMI \u2122\nn NIGERIAN 800106076`);
  console.log(r);
  expect(r.documentType).toBe("Nigerian Passport");
  expect(r.firstName).toBe("Nengimonyun Bunmi");
  expect(r.lastName).toBe("Tee Ale");
});

describe("NIN card names", () => {
  it("reads bilingual labels with values on the next line", () => {
    const r = parseNigerianId(
      [
        "FEDERAL REPUBLIC OF NIGERIA",
        "NATIONAL IDENTITY CARD",
        "Surname/Nom",
        "OKAFOR",
        "Given Names/Prenoms",
        "ADEBAYO CHUKWU",
        "NIN 12345678901",
      ].join("\n"),
    );
    expect(r.documentType).toBe("Nigerian NIN");
    expect(r.lastName).toBe("Okafor");
    expect(r.firstName).toBe("Adebayo Chukwu");
    expect(r.documentNumber).toBe("12345678901");
  });

  it("recovers names positionally when labels are lost", () => {
    const r = parseNigerianId(
      [
        "FEDERAL REPUBLIC OF NIGERIA",
        "NATIONAL IDENTITY MANAGEMENT COMMISSION",
        "BELLO",
        "MUSA IBRAHIM",
        "Date of Birth 01/02/1990",
        "National Identification Number",
        "22233344455",
      ].join("\n"),
    );
    expect(r.lastName).toBe("Bello");
    expect(r.firstName).toBe("Musa Ibrahim");
    expect(r.documentNumber).toBe("22233344455");
  });

  it("does not return bilingual label halves as names", () => {
    const r = parseNigerianId(
      ["NIMC", "SURNAME/NOM: ADEYEMI", "GIVEN NAMES/PRENOMS: TUNDE", "NIN: 99988877766"].join("\n"),
    );
    expect(r.lastName).toBe("Adeyemi");
    expect(r.firstName).toBe("Tunde");
  });
});
