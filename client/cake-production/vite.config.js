import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Mirrors client/vite.config.js's config-reading logic exactly, so this app
// resolves the same POS server target from the same shared mtc.config.env.
function readConfig() {
  const file = fileURLToPath(new URL('../../mtc.config.env', import.meta.url));
  if (!fs.existsSync(file)) return {};

  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
  );
}

const net = readConfig();
const devHost = net.DEV_IP || '0.0.0.0';
const devPort = 5174; // client/ dev server uses 5173
const appHost = net.HTTP_IP && net.HTTP_IP !== '0.0.0.0' ? net.HTTP_IP : 'localhost';
const httpsEnabled = String(net.HTTPS_ENABLED || '').toLowerCase() === 'true';
const appProtocol = httpsEnabled ? 'https' : 'http';
const appPort = httpsEnabled
  ? Number(net.HTTPS_PORT) || 443
  : Number(net.PORT || net.HTTP_PORT) || 3000;
const appTarget = `${appProtocol}://${appHost}:${appPort}`;

export default defineConfig({
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
    host: devHost,
    port: devPort,

    proxy: {
      '/api': { target: appTarget, changeOrigin: true, secure: false },
      '/uploads': { target: appTarget, changeOrigin: true, secure: false },
      '/public': { target: appTarget, changeOrigin: true, secure: false },
      '/socket.io': { target: appTarget, changeOrigin: true, secure: false, ws: true },
    },
  },
});
