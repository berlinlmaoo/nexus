import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Backend target for the dev proxy.
//   :3000 = live NEXUS app in Docker (nexus-app:prod) — REAL database
//   :3020 = local `next dev` server (dev data)
// Override: VITE_API_TARGET=http://127.0.0.1:3020 npm run dev
const API_TARGET = process.env.VITE_API_TARGET || "http://127.0.0.1:3000";
const API_HOST = API_TARGET.replace(/^https?:\/\//, "");

function applyProxyHeaders(proxy: { on: (event: "proxyReq", cb: (proxyReq: { setHeader: (k: string, v: string) => void }) => void) => void }) {
  proxy.on("proxyReq", (proxyReq) => {
    proxyReq.setHeader("origin", "http://127.0.0.1");
    proxyReq.setHeader("x-forwarded-proto", "http");
    proxyReq.setHeader("x-forwarded-host", API_HOST);
  });
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@heroui") || id.includes("framer-motion")) return "ui-vendor";
          if (id.includes("@tanstack")) return "tanstack-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          if (id.includes("date-fns")) return "date-vendor";
          return "vendor";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4178,
    allowedHosts: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, ws: true, configure: applyProxyHeaders },
      "/auth": { target: API_TARGET, changeOrigin: true, configure: applyProxyHeaders },
    },
  },
  // Production-ish serving of the built app (`vite preview`) — same /api+/auth proxy
  // as dev so auth/backend behave identically. Run under launchd for auto-restart.
  preview: {
    host: "127.0.0.1",
    port: 4178,
    allowedHosts: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, ws: true, configure: applyProxyHeaders },
      "/auth": { target: API_TARGET, changeOrigin: true, configure: applyProxyHeaders },
    },
  },
});
