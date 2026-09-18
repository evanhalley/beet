import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `.claude/worktrees/**` holds nested git worktrees — separate checkouts
    // that must not be collected here. Their `@/...` imports resolve against
    // *this* tree's src via the alias above, so they'd silently test the wrong
    // files and break whenever a module moves on one side only.
    exclude: ["src-tauri/**", "node_modules/**", ".claude/worktrees/**"],
  },
});
