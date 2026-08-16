import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Oniguruma's WASM must inline as a data URL: the packaged app loads
    // index.html over file://, where fetch() of a relative asset fails.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.wasm') ? true : undefined),
    rollupOptions: {
      output: {
        manualChunks(id) {
          // The inlined Oniguruma WASM (~600 kB as base64) must stay in its
          // own dynamically-imported chunk so it only loads when a grammar
          // extension activates.
          if (id.includes('.wasm')) return undefined;
          if (id.includes('node_modules/vscode-textmate') || id.includes('node_modules/vscode-oniguruma')) {
            return 'textmate';
          }
          if (id.includes('node_modules/monaco-editor')) return 'monaco';
          if (id.includes('node_modules/xterm') || id.includes('node_modules/@xterm')) {
            return 'terminal';
          }
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
