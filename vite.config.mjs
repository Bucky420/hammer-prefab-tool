import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(ROOT, "public");

export default defineConfig({
  root: PUBLIC_ROOT,
  publicDir: false,
  cacheDir: path.join(ROOT, "node_modules", ".vite"),
  appType: "spa",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 8787,
    strictPort: true,
    open: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if (!response || response.headersSent) return;
            response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "1" });
            response.end(JSON.stringify({ ok: false, error: { code: "BACKEND_RESTARTING", message: "The development backend is restarting." } }));
          });
        }
      }
    },
    hmr: { overlay: true },
    fs: { strict: true, allow: [PUBLIC_ROOT] }
  }
});
