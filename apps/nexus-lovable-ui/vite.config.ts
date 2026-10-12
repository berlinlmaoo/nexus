import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Writes a `.gz` twin (level 9) next to every text asset of the build, so nginx can send it as is
 * (`gzip_static on`, maintenance/phaethon.conf) instead of compressing on each request or not at all.
 */
function precompress(): Plugin {
  let outDir = "dist";
  return {
    name: "nexus-precompress",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const f = join(dir, name);
          if (statSync(f).isDirectory()) { walk(f); continue; }
          if (!/\.(js|mjs|css|html|svg|json|txt|map)$/.test(name) || statSync(f).size < 1024) continue;
          writeFileSync(`${f}.gz`, gzipSync(readFileSync(f), { level: 9 }));
        }
      };
      walk(outDir);
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    precompress(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Only the libraries EVERY screen needs get a shared chunk (perf pass, 12 Oct 2026). Everything else
        // (TipTap/ProseMirror/Yjs, formulajs/jstat, recharts, leaflet, date-fns, …) is left to Rollup, so it
        // travels with the lazy route/component that imports it instead of a 2 MB "vendor" chunk loaded on
        // every first visit.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react-vendor";
          if (id.includes("@tanstack")) return "tanstack-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          return undefined;
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
