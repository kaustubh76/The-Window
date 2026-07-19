import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

// THE WINDOW dashboard — Vite config.
// esnext target + WASM handling mirror the sibling app: eERC / snarkjs / circomlibjs
// need top-level await and must not be pre-bundled. See spike/NOTES.md Q7.
// nodePolyfills provides Buffer/process/util/assert globals that circomlibjs (blake-hash,
// ffjavascript) require at module-eval time in the browser.
export default defineConfig({
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
