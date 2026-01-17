import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prefer-const": "off",
      "no-useless-escape": "off",
      "no-prototype-builtins": "off",
      "no-useless-catch": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "no-control-regex": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "deprecated/**", "coverage/**"],
  }
);
