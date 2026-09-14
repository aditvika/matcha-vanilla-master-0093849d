// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
export default defineConfig({
  vite: {
    // NOTE: do NOT set `base: './'` — a relative base makes server-function
    // calls resolve against the current page path (e.g. /processing/_serverFn/...),
    // which returns the HTML router instead of JSON.
    base: '/',

    build: {

      rollupOptions: {
        output: {
          entryFileNames: `assets/index.js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`
        }
      }
    }
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
