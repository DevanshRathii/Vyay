import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Deterministic 32-byte key so blind-index tests (bidx equality used
      // by dedup/Shortcut matching) run without real secrets. Tests that
      // exercise a specific key value set process.env.BLIND_INDEX_KEY
      // themselves (see tests/blind-index.test.ts).
      BLIND_INDEX_KEY: Buffer.alloc(32, 1).toString("base64"),
    },
  },
});
