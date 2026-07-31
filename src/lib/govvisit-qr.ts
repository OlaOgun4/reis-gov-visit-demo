const PASS_CODE = /^GV-[A-Z0-9]{2,12}-\d{4}-\d{4,12}$/;

export type GovVisitPassQrV1 = {
  type: "govvisit-pass";
  version: 1;
  passCode: string;
};

export function encodeGovVisitPassQr(passCode: string) {
  const normalized = passCode.trim().toUpperCase();
  if (!PASS_CODE.test(normalized)) throw new Error("Invalid GovVisit pass code.");
  return JSON.stringify({ type: "govvisit-pass", version: 1, passCode: normalized });
}

export function parseGovVisitPassQr(raw: string): GovVisitPassQrV1 | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.type !== "govvisit-pass" ||
      value.version !== 1 ||
      typeof value.passCode !== "string"
    ) {
      return null;
    }
    const passCode = value.passCode.trim().toUpperCase();
    if (!PASS_CODE.test(passCode)) return null;
    return { type: "govvisit-pass", version: 1, passCode };
  } catch {
    return null;
  }
}
