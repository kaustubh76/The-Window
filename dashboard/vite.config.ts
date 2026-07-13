import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

// THE WINDOW dashboard — Vite config.
// esnext target + WASM handling mirror the sibling app: eERC / snarkjs / circomlibjs
// need top-level await and must not be pre-bundled. See spike/NOTES.md Q7.
// nodePolyfills provides Buffer/process/util/assert globals that circomlibjs (blake-hash,
// ffjavascript) require at module-eval time in the browser.
export default defineConfig(({ mode }) => {
  // Production builds must SAY which adapter they ship: ADAPTER_MODE defaults to
  // 'mock' (src/config.ts), so building without the gitignored .env.production
  // (fresh clone, Vercel source-build) would silently ship the in-browser
  // simulation instead of the live Fuji app. Fail the build instead.
  if (mode === 'production' && !loadEnv(mode, __dirname, 'VITE_').VITE_ADAPTER) {
    throw new Error(
      'VITE_ADAPTER is unset for a production build — set it in dashboard/.env.production ' +
      "('live' for the hosted app, 'mock' only for an intentional demo build). See notes/08.",
    );
  }
  return config;
});

const config = defineConfig({
  plugins: [
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // No COOP/COEP: proving is server-side now (Control API), so the browser needs no
    // SharedArrayBuffer/snarkjs — and those headers only complicate cross-origin fetch.
    // Same-origin proxies to the backend services (used when VITE_{INDEXER,CONTROL}_URL
    // are set to the proxied paths; the .env may also point at the ports directly).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787', // indexer
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api/, ''),
      },
      '/control': {
        target: 'http://127.0.0.1:8899', // Control API
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/control/, ''),
      },
    },
    fs: {
      // Allow serving the sibling node crypto package (for prebuilt artifacts).
      allow: ['.', path.resolve(__dirname, '../packages')],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    // circomlibjs is CJS with mixed exports; let Vite pre-bundle it for a clean browser build.
    include: ['circomlibjs'],
  },
  esbuild: {
    target: 'esnext',
  },
});
