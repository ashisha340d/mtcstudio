import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const devPort = Number(env.VITE_DEV_SERVER_PORT) || 5173;
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    build: {
      outDir: '../server/public/client-build',
      emptyOutDir: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // Stable vendor chunk — app deploys don't bust the framework cache
            vendor: ['react', 'react-dom', 'react-router'],
          },
        },
      },


    },

    server: {
      host: '0.0.0.0',
      port: devPort,

      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },

        '/uploads': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },

        '/public': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },

        '/socket.io': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
  };
});
