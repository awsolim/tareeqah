import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #e7f8ee 0%, #8ccbbd 58%, #2f8fb3 100%)",
          color: "#26323a",
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: 0,
          borderRadius: 38,
        }}
      >
        T
      </div>
    ),
    size,
  );
}
