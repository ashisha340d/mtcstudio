import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  // Mirrors client/vite.config.js's config-reading logic exactly, so this app
  // resolves the same POS server target from the same client/.env files.
  const env = loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), '');
  const devPort = 5174; // client/ dev server uses 5173
  const appTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

  return {
  base: '/cake-app/',

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-180-apple-touch.png'],
      manifest: {
        name: 'Cake Production',
        short_name: 'Cake Prod',
        description: 'Offline-first cake production workspace for the Pastry Chef',
        start_url: '/cake-app/',
        scope: '/cake-app/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#c1440e',
        background_color: '#fff7ef',
        lang: 'en',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Only precache the app shell/static assets. No runtimeCaching entries
      // are added, so /api and /socket.io requests are never intercepted or
      // cached by the service worker — they pass straight through to the
      // network, same-origin, exactly as the spec requires.
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: '/cake-app/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
      },
    }),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    outDir: '../../server/public/cake-production-build',
    emptyOutDir: true,
  },

  server: {
    host: '0.0.0.0',
    port: devPort,

    proxy: {
      '/api': { target: appTarget, changeOrigin: true, secure: false },
      '/uploads': { target: appTarget, changeOrigin: true, secure: false },
      '/public': { target: appTarget, changeOrigin: true, secure: false },
      '/socket.io': { target: appTarget, changeOrigin: true, secure: false, ws: true },
    },
  },
  };
});
