import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Der Client liegt in src/client und wird nach dist/client gebaut.
// Im Produktivbetrieb liefert der Hono-Server diese Dateien selbst aus,
// in der Entwicklung reicht Vite /api an den Server auf Port 3000 durch.
export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  // Excalidraw fragt diese Variable zur Laufzeit ab; ohne Wert bricht das Bündel.
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Mit Schrägstrich: ein bloßes '/api' finge auch die Quelldatei /api.ts ab.
      '/api/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
