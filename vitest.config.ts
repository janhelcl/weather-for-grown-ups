import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli.ts",
        "src/cli/catalog-command.ts",
        "src/cli/point-commands.ts",
        "src/cli/diagnostic-commands.ts",
        "src/cli/transect-command.ts",
        "src/cli/area-command.ts",
        "src/mcp.ts",
      ],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
