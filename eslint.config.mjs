import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src-tauri/**",
    "design/**",
    // Nested git worktrees are separate checkouts; the outer repo shouldn't
    // lint them. Without this their `design/` copies escape the rule above,
    // which only matches the pattern at the repo root.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
