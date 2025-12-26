// vite.config.ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command, mode }) => ({
  base: "/",
  plugins: [
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
        type: "module",
      },
      manifest: {
        name: "Life IO",
        short_name: "LifeIO",
        description: "Local-first Personal Knowledge Management",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        orientation: "portrait-primary",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    // ✅ FIX: Bind to all network interfaces (0.0.0.0) so iOS device on LAN can connect
    host: true, 
    port: 3000,
    allowedHosts: true,
    hmr: {
      clientPort: process.env.VITE_HMR_SECURE === "true" ? 443 : undefined,
    },
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:42069",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:42069",
        ws: true,
        changeOrigin: true,
      },
    },
  },
}));
