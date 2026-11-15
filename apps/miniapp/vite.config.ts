import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `vite build --mode demo` → GitHub Pages build: base /dokonim/, LocalApi (PGlite in a Web Worker), no
 * Telegram script (it is loaded on demand only when launched inside Telegram). Other modes → HttpApi.
 */
function telegramScript(enabled: boolean): Plugin {
  return {
    name: 'dokonim:telegram-script',
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace('<!-- telegram-web-app -->', '<script src="https://telegram.org/js/telegram-web-app.js?59"></script>');
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? '/dokonim/' : '/',
    // Target is derived from the mode (not an .env file, which is gitignored): demo → LocalApi, else HttpApi.
    define: {
      'import.meta.env.VITE_TARGET': JSON.stringify(demo ? 'demo' : (process.env.VITE_TARGET ?? 'http')),
      // dev: same origin, proxied to the local API below (so no CORS setup is needed)
      'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? (mode === 'production' ? 'https://api.dokonim.uz' : '')),
    },
    plugins: [react(), telegramScript(!demo)],
    // PGlite ships its own WASM + data bundle resolved via import.meta.url; pre-bundling breaks those URLs.
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
      assetsInlineLimit: (file) => (file.endsWith('.wasm') || file.endsWith('.data') || file.endsWith('.tar.gz') ? false : undefined),
    },
    // apps/api listens on :8080 by default (PORT); API_PROXY_TARGET points the dev proxy elsewhere
    server: { port: 5173, proxy: { '/v1': process.env.API_PROXY_TARGET ?? 'http://localhost:8080' } },
    preview: { port: 4173 },
  };
});
