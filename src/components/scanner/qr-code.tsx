import { useEffect, useState } from "react";

/** Renders a real scannable QR code for the visitor pass, encoded on the device. */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let active = true;
    import("qrcode").then(async (mod) => {
      const url = await mod.toDataURL(value, {
        width: size * 2,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        className="mx-auto animate-pulse rounded-xl bg-muted"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={`QR code for visitor pass ${value}`}
      width={size}
      height={size}
      className="mx-auto rounded-xl bg-white p-2"
    />
  );
}
