import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Mark Node.js builtins and peer deps as external
  external: ["node:async_hooks", "node:crypto", "ws"],
});
