import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isMobileBuild = mode === 'mobile';
  const mobileProxy = {
    '/api/arxiv-pdf': {
      target: 'https://arxiv.org',
      changeOrigin: true,
      secure: true,
      headers: { Accept: 'application/pdf' },
      rewrite: (path: string) => path.replace(/^\/api\/arxiv-pdf/u, '/pdf')
    },
    '/api/arxiv': {
      target: 'https://export.arxiv.org',
      changeOrigin: true,
      secure: true,
      headers: { Accept: 'application/atom+xml' },
      rewrite: (path: string) => path.replace(/^\/api\/arxiv/u, '/api/query')
    }
  };
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
      host: isMobileBuild ? '0.0.0.0' : '127.0.0.1',
      port: isMobileBuild ? 5174 : 5173,
      strictPort: true,
      proxy: isMobileBuild ? mobileProxy : undefined
    },
    preview: {
      host: '0.0.0.0',
      port: 4174,
      strictPort: true,
      proxy: isMobileBuild ? mobileProxy : undefined
    }
  };
});
