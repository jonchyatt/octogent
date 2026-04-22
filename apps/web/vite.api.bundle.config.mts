import { builtinModules } from "node:module";
import { resolve } from "node:path";

import { defineConfig } from "vite";

const externals = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "node-pty",
  "ws",
  // Native-addon deps must stay external — `better-sqlite3` is loaded via
  // `bindings`, which references the CommonJS `__filename` global that is
  // NOT defined in the emitted ESM bundle (see docs/KNOWN-ISSUES.md §1).
  // Inlining these into the bundle crashes on first native-addon load.
  // External = runtime require() from node_modules, which polyfills correctly.
  "better-sqlite3",
  "bindings",
];

export default defineConfig({
  build: {
    outDir: resolve(__dirname, "../../dist/api"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "../api/src/cli.ts"),
      formats: ["es"],
      fileName: () => "cli.js",
    },
    minify: false,
    sourcemap: true,
    target: "node22",
    rollupOptions: {
      external: externals,
      output: {
        entryFileNames: "cli.js",
      },
    },
  },
});
