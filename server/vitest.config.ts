import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@progress-island/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
