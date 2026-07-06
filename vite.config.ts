import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Set HTTPS=true to serve a self-signed cert — needed for the iPad to use GPS
// over the LAN (Safari only grants geolocation on secure origins / localhost).
const useHttps = process.env.HTTPS === "true";

// When deploying to GitHub Pages the app is served from /<repo>/, so set
// BASE_PATH (e.g. "/bechtel-course-guide/"). Defaults to "/" for local + custom hosts.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  // Listen on all interfaces so an iPad on the same LAN/hotspot can connect.
  server: { host: true, port: 5199 },
  preview: { host: true, port: 5199 },
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Summit Bechtel Course Guide",
        short_name: "Course Guide",
        description: "Drive the course at the Summit Bechtel Reserve with auto-popping points of interest.",
        theme_color: "#1b5e3f",
        background_color: "#12211a",
        display: "standalone",
        orientation: "any",
        // Relative so it works whether hosted at "/" or "/<repo>/".
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the app shell.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Runtime-cache map tiles so viewed areas work offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /tile|arcgisonline|openstreetmap|basemaps|usgs/i.test(url.href),
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 8000, maxAgeSeconds: 60 * 60 * 24 * 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
});
