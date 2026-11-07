import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import vetClinic from "./eslint-rules/index.mjs";

// Money, quantity, dose and weight code: exact arithmetic only (SCHEMA G2-G3, G12).
const EXACT_PATHS = [
  "features/keystone/**/*.ts",
  "features/integrations/**/*.ts",
  "features/platform/**/*.ts",
];

export default defineConfig([
  globalIgnores([".keystone/**", ".runtime/**", "node_modules/**", "migrations/**"]),
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "react/no-unescaped-entities": "warn",
      "react/no-children-prop": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // React 19 compiler-adoption debt inherited from the starter UI remains visible.
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: EXACT_PATHS,
    // lib/decimal and lib/money are the one sanctioned conversion layer (Decimal#toFixed is exact there).
    ignores: ["**/*.test.ts", "features/keystone/lib/decimal.ts", "features/keystone/lib/money.ts", "features/keystone/mcp-oauth/**", "features/keystone/models/**", "features/keystone/security/**"],
    plugins: { "vet-clinic": vetClinic },
    rules: { "vet-clinic/no-number-on-money": "error" },
  },
  {
    files: ["features/keystone/models/**/*.ts"],
    plugins: { "vet-clinic": vetClinic },
    rules: { "vet-clinic/no-float-fields": "error" },
  },
  {
    // Layering (BUILD-PLAN CI; enforced here in place of dependency-cruiser): the domain core is
    // framework-free, and screens reach it only through GraphQL.
    files: ["features/keystone/lib/**/*.ts", "features/keystone/domain/**/*.ts", "features/integrations/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.node-test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["next", "next/*", "react", "react-dom", "@/features/dashboard/*", "@/features/platform/*", "@/components/*", "**/mutations/*"], message: "The domain core must not import UI, Next.js or GraphQL resolver code." },
        ],
      }],
    },
  },
  {
    files: ["features/platform/**/*.{ts,tsx}", "features/dashboard/**/*.{ts,tsx}", "app/dashboard/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@prisma/client", "@/features/keystone/lib/*", "@/features/keystone/domain/*", "@/features/keystone/mutations/*"], message: "Screens go through GraphQL (keystoneClient) so access rules and commands apply." },
        ],
      }],
    },
  },
]);
