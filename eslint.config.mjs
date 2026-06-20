// eslint.config.mjs — minimal flat config for ESLint 9 (DevOps scaffold).
// Intentionally lenient so it gates CI without blocking on style. The dev team
// (TL/BE/WEB/MOB) owns tightening these rules later.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "prisma/migrations/**", "**/*.mjs"],
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
    },
  },
);
