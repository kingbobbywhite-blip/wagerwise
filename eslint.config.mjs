import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Next build output and its generated types
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Archived snapshots, not part of the app
    "archive/**",
    // Vendored, minified tesseract.js worker and wasm loaders
    "public/**",
    "coverage/**",
  ]),
])
