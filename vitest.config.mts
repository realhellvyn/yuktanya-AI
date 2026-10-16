import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only melempar saat diimpor di luar Next; di tes cukup stub kosong.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"], testTimeout: 20000 },
});
