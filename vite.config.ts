import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isMobileBuild = mode === 'mobile';
  return {
    base: './',
    plugins: [react()],
    build: {
      outDir: isMobileBuild ? 'dist-mobile' : 'dist-renderer',
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
            if (!isMobileBuild && id.includes('@univerjs')) {
              return 'univer';
            }
          }
        }
      }
    },
    server: {
      port: isMobileBuild ? 5174 : 5173,
      strictPort: true
    }
  };
});
