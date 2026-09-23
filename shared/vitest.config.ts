import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@progress-island/shared": path.resolve(__dirname, "./src/index.ts"),
    },
  },
});
