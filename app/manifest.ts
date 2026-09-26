import type { MetadataRoute } from "next"

/**
 * Web app manifest, so "Add to Home Screen" produces a real standalone app
 * rather than a Safari bookmark.
 *
 * `display: standalone` is the part that matters on a phone: it drops the
 * browser chrome, which on a small screen is most of the vertical space the
 * board needs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WagerWise — Basketball Prop Terminal",
    short_name: "WagerWise",
    description:
      "NBA, WNBA and college basketball prop and parlay analysis: devigged fair lines, calibrated probabilities and expected value.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0f12",
    theme_color: "#0c0f12",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  }
}
