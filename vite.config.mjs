import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(ROOT, "public");
const BUILD_ID =
  process.env.HAMMER_BUILD_ID ||
  `${process.env.npm_package_version || "dev"}-${Date.now().toString(36)}`;
const BASE = process.env.HAMMER_BASE_PATH || "./";
const SERVICE_WORKER_SOURCE = fs.readFileSync(
  path.join(PUBLIC_ROOT, "sw.js"),
  "utf8",
);

const HOSTED_API_ID = "\0hammer-hosted-api";
const HOSTED_API_SOURCE = String.raw`
function localServerOnly(action) {
  return Promise.reject(new Error(action + " is available in local server mode"));
}

function download(path, content, type) {
  const filename = String(path || "prefab.vmf").split(/[\\/]/).pop();
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return Promise.resolve({ ok: true, path: filename, bytes: new Blob([content]).size });
}

export const api = {
  config: () => Promise.resolve({ ok: true, config: { storage: "browser" } }),
  projects: () => localServerOnly("Project storage"),
  files: () => localServerOnly("VMF browsing"),
  load: () => localServerOnly("Project loading"),
  save: () => localServerOnly("Project storage"),
  autosave: () => localServerOnly("Autosave"),
  openVMF: () => localServerOnly("VMF browsing"),
  exportVMF: (path, vmf) => download(path, vmf, "text/plain;charset=utf-8"),
};
`;

function hostedBuildPlugin() {
  return {
    name: "hammer-hosted-build",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        source === "./api.js" &&
        importer?.replaceAll("\\", "/").endsWith("/public/js/app.js")
      )
        return HOSTED_API_ID;
      return null;
    },
    load(id) {
      return id === HOSTED_API_ID ? HOSTED_API_SOURCE : null;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace(
            /\s*<script type="importmap" data-local-server>[\s\S]*?<\/script>/,
            "",
          )
          .replace(
            "<title>Hammer Prefab Tool</title>",
            `<title>Hammer Prefab Tool</title>\n    <meta name="hammer-build-id" content="${BUILD_ID}" />`,
          );
      },
    },
    generateBundle(_options, bundle) {
      const files = [
        "index.html",
        ...Object.keys(bundle).filter(
          (file) => file !== "index.html" && !file.endsWith(".map"),
        ),
      ].sort();

      const version = {
        id: BUILD_ID,
        generatedAt: new Date().toISOString(),
        files,
      };
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(version, null, 2)}\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: SERVICE_WORKER_SOURCE.replace(
          '"__HAMMER_BUILD_ID__"',
          JSON.stringify(BUILD_ID),
        ),
      });
    },
  };
}

export default defineConfig({
  root: PUBLIC_ROOT,
  publicDir: false,
  base: BASE,
  cacheDir: path.join(ROOT, "node_modules", ".vite"),
  appType: "spa",
  clearScreen: false,
  plugins: [hostedBuildPlugin()],
  build: {
    outDir: path.join(ROOT, "dist"),
    emptyOutDir: true,
  },
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
            response.writeHead(503, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "Retry-After": "1",
            });
            response.end(
              JSON.stringify({
                ok: false,
                error: {
                  code: "BACKEND_RESTARTING",
                  message: "The development backend is restarting.",
                },
              }),
            );
          });
        },
      },
    },
    hmr: { overlay: true },
    fs: { strict: true, allow: [PUBLIC_ROOT] },
  },
});
