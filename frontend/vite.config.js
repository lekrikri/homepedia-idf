import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt", "icons/*.png"],
      manifest: {
        name: "HomePedia IDF",
        short_name: "HomePedia",
        description:
          "Analyse immobilière Île-de-France — 1 266 communes, données DVF, DPE, Prophet",
        theme_color: "#0f1724",
        background_color: "#0f1117",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "fr",
        categories: ["finance", "real-estate", "map"],
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
        shortcuts: [
          {
            name: "Carte",
            short_name: "Carte",
            url: "/carte",
            icons: [{ src: "icons/icon-192.png", sizes: "192x192" }],
          },
          {
            name: "Chatbot IA",
            short_name: "IA",
            url: "/carte",
            icons: [{ src: "icons/icon-192.png", sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        // Exclure Cesium (>5MB) du précaching — trop gros pour Workbox
        globPatterns: ["**/*.{css,html,ico,png,svg,woff2}", "assets/*.js"],
        globIgnores: ["**/Cesium*", "**/cesium*", "**/*chunk-cesium*"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4MB max
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.run\.app\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24h
              },
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /^https:\/\/api\.maptiler\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "tiles-cache",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
