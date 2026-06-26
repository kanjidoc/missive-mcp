const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

/**
 * Lean ESLint flat config — JS + TypeScript recommended rules.
 *
 * Unlike the OAuth/axios-based reference this project was modeled on, the
 * Missive client is a hand-written `fetch` wrapper that needs no `any`, so
 * `no-explicit-any` is left ENABLED for stricter typing of `MissiveResult`
 * and the tool handlers. `test/**` is not linted (mirrors the reference).
 */
module.exports = tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "test/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed args/vars are intentionally unused (e.g. an unused handler arg).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
