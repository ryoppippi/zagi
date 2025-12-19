import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./fixtures/setup.ts"],
    benchmark: {
      include: ["src/**/*.bench.ts"],
    },
  },
});
