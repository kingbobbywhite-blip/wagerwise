import { ImageResponse } from "next/og"

// iOS ignores SVG touch icons, so the home-screen icon is rendered as a PNG.
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

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
          background: "#0c0f12",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 32 32">
          <path
            d="M4 19h4.2l2.6-7 3.2 11 3.4-14 3 10h7.6"
            fill="none"
            stroke="#4ade80"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size,
  )
}
