import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["performance/benchmarks/**/*.bench.ts"],
  },
});
