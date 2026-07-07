import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

function readConfig() {
  const file = fileURLToPath(new URL('../mtc.config.env', import.meta.url));
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
const devPort = Number(net.DEV_PORT) || 5173;
const appHost = net.HTTP_IP && net.HTTP_IP !== '0.0.0.0' ? net.HTTP_IP : 'localhost';
const httpsEnabled = String(net.HTTPS_ENABLED || '').toLowerCase() === 'true';
const appProtocol = httpsEnabled ? 'https' : 'http';
const appPort = httpsEnabled
  ? Number(net.HTTPS_PORT) || 443
  : Number(net.PORT || net.HTTP_PORT) || 3000;
const appTarget = `${appProtocol}://${appHost}:${appPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    outDir: '../server/public/client-build',
    emptyOutDir: true,
  },

  server: {
    host: devHost,
    port: devPort,

    proxy: {
      '/api': {
        target: appTarget,
        changeOrigin: true,
        secure: false,
      },

      '/uploads': {
        target: appTarget,
        changeOrigin: true,
        secure: false,
      },

      '/public': {
        target: appTarget,
        changeOrigin: true,
        secure: false,
      },

      '/socket.io': {
        target: appTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});