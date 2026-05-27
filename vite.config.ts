import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('pdfjs-dist')) {
            return 'pdfjs';
          }

          if (id.includes('katex')) {
            return 'katex';
          }

          if (id.includes('ag-grid')) {
            return 'ag-grid';
          }

          if (id.includes('react')) {
            return 'react-vendor';
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
