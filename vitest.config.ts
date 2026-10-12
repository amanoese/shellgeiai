import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests import the compiled runtime. Vite otherwise ignores its default outDir.
  build: { emptyOutDir: false }
});
