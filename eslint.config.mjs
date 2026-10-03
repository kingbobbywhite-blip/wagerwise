import { defineConfig, globalIgnores } from "eslint/config"
import nextPlugin from "@next/eslint-plugin-next"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

// Built from the same pieces as eslint-config-next (Next rules, React Hooks,
// typescript-eslint recommended) rather than that package itself, because its
// bundled eslint-plugin-react, -import and -jsx-a11y do not run on ESLint 10.
export default defineConfig(
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "archive/**",
    "next-env.d.ts",
    // Vendored, minified Tesseract worker and WASM loaders served as-is.
    "public/tesseract/**",
  ]),
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  nextPlugin.configs["core-web-vitals"],
)
