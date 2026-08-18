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
      // Кіоск перезбирається й переоткривається щодня (start-desk.bat), але
      // тримає той самий Chrome-профіль — старий service worker інакше й
      // далі обслуговує вчорашній JS-бандл. Дефолтний інжектований
      // registerSW.js лише реєструє SW і НІКОЛИ не перевіряє оновлення
      // (жодного registration.update()) — тому кіоск міг тижнями не бачити
      // нових збірок (той самий баг був у Шопі). injectRegister: null
      // вимикає той дефолтний скрипт; реальна реєстрація — в src/main.jsx
      // через virtual:pwa-register, де є явний update() і
      // автоперезавантаження при новій версії.
      injectRegister: null,
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
