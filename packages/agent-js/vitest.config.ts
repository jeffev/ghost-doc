import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],
    },
  },
  resolve: {
    // In development, resolve @ghost-doc/shared-types to source TypeScript
    // so tests work without building shared-types first.
    alias: {
      "@ghost-doc/shared-types": resolve(__dirname, "../shared-types/src/index.ts"),
    },
  },
});
