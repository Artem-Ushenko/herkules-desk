import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// strictPort: захист від «примарної каси» на іншому порту — той самий
// принцип, що в сестринському проєкті (Геркулес Шоп)
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Геркулес Клуб',
        short_name: 'Геркулес',
        description: 'Облік клієнтів фітнес-студії: допуск за карткою, абонементи, візити',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#f4f5f7',
        theme_color: '#2456d6',
        lang: 'uk',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Ніякого CDN у рантаймі (розділ 1 ТЗ): precache бере лише зібрані
        // локальні файли, runtime caching — лише той самий origin.
        globPatterns: ['**/*.{js,css,html,svg,ico}'],
        navigateFallback: 'index.html',
        runtimeCaching: [{
          urlPattern: ({ sameOrigin }) => sameOrigin,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'herkules-runtime' }
        }]
      }
    })
  ],
  server: {
    port: 5173,
    strictPort: true
  },
  preview: {
    port: 8080,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
