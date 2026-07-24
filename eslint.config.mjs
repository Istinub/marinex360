// eslint.config.mjs — minimal flat config for ESLint 9 (DevOps scaffold).
// Intentionally lenient so it gates CI without blocking on style. The dev team
// (TL/BE/WEB/MOB) owns tightening these rules later.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // Compiled/build artifacts that sometimes land in source folders alongside their
    // .ts originals (e.g. a stray password.js next to password.ts, or prisma/seed.js
    // next to seed.ts) should never be linted as source — they are not hand-written
    // and are expected to disappear once the emitting build step is corrected (see
    // BE follow-up in the S0-7 CI handoff). apps/mobile/**/*.js is a separate
    // case: hand-written CommonJS Sprint-0 mobile sync-engine spike scripts that
    // predate this ESLint config and aren't part of the TS/ESM app codebase.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "prisma/migrations/**",
      "**/*.mjs",
      "prisma/seed.js",
      "apps/api/src/**/*.js",
      "apps/mobile/**/*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
