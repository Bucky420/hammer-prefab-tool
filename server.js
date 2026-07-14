"use strict";
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = __dirname;
// Development supervisor restarts this backend independently of Vite.
// Backend restart handoff is managed by dev.mjs.
const CONFIG_FILE = path.join(ROOT, "config.json");
const LOG_DIRECTORY = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIRECTORY, "server.log");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const defaults = { port: 8787, projectDirectory: "projects", importDirectory: "projects", exportDirectory: "exports", backupDirectory: "backups", autosaveIntervalSeconds: 30 };
let config = defaults;
let watchers = [];
fs.mkdirSync(LOG_DIRECTORY, { recursive: true });

function timestamp() { return new Date().toISOString(); }
function writeLog(line) { fs.appendFile(LOG_FILE, `${line}\n`, error => { if (error) console.error(`[${timestamp()}] Could not write server log: ${error.message}`); }); }
function log(level, message, details = "") { const line = `[${timestamp()}] ${message}${details ? ` ${details}` : ""}`; console[level](line); writeLog(line); }
function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); }
function fail(res, status, code, message) { json(res, status, { ok: false, error: { code, message } }); }
function logError(context, status, code, error) { const message = error?.message || String(error); const line = `[${timestamp()}] ${context.method || "SERVER"} ${context.url || ""} ${status} ${code}: ${message}`; console.error(line); writeLog(line); if (error?.stack) { console.error(error.stack); writeLog(error.stack); } }
async function readBody(req) { let text = ""; for await (const chunk of req) { text += chunk; if (text.length > 10 * 1024 * 1024) throw new Error("Request body is too large"); } try { return text ? JSON.parse(text) : {}; } catch { const e = new Error("Request body must be valid JSON"); e.status = 400; throw e; } }
function absoluteDirectory(value) { return path.resolve(ROOT, value); }
function configuredDirectory(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) { const e = new Error("Configured directories must be non-empty paths"); e.status = 400; throw e; }
  return absoluteDirectory(value);
}
function roots() { return { project: absoluteDirectory(config.projectDirectory), import: absoluteDirectory(config.importDirectory), export: absoluteDirectory(config.exportDirectory), backup: absoluteDirectory(config.backupDirectory) }; }
function safePath(kind, input, extensions) {
  if (typeof input !== "string" || !input.trim()) { log("warn", "Rejected empty file path", `kind=${kind}`); const e = new Error("A file path is required"); e.status = 400; throw e; }
  const root = roots()[kind]; const target = path.resolve(root, input);
  if (target !== root && !target.startsWith(root + path.sep)) { log("warn", "Rejected path outside allowed root", `kind=${kind} input=${JSON.stringify(input)}`); const e = new Error("Path is outside the allowed directory"); e.status = 403; throw e; }
  if (extensions && !extensions.includes(path.extname(target).toLowerCase())) { log("warn", "Rejected file extension", `kind=${kind} input=${JSON.stringify(input)}`); const e = new Error(`Expected one of: ${extensions.join(", ")}`); e.status = 400; throw e; }
  return target;
}
async function ensureRoots() { for (const folder of Object.values(roots())) await fsp.mkdir(folder, { recursive: true }); }
async function loadConfig() { try { config = { ...defaults, ...JSON.parse(await fsp.readFile(CONFIG_FILE, "utf8")) }; } catch (e) { if (e.code !== "ENOENT") throw e; await saveConfig(); } for (const key of ["projectDirectory", "importDirectory", "exportDirectory", "backupDirectory"]) config[key] = configuredDirectory(config[key]); if (process.env.HAMMER_PORT) config.port = Number(process.env.HAMMER_PORT); await ensureRoots(); }
async function saveConfig() { await fsp.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n"); }
async function backup(name, content, suffix) { const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const base = path.basename(name, path.extname(name)).replace(/[^a-z0-9_-]/gi, "_"); const file = path.join(roots().backup, `${base}-${stamp}-${suffix}`); await fsp.writeFile(file, content); return path.basename(file); }
async function list(kind, extension) { const root = roots()[kind]; const items = await fsp.readdir(root, { withFileTypes: true }); return Promise.all(items.filter(x => x.isFile() && (!extension || x.name.toLowerCase().endsWith(extension))).map(async x => ({ name: x.name, size: (await fsp.stat(path.join(root, x.name))).size, modified: (await fsp.stat(path.join(root, x.name))).mtime.toISOString() }))); }
function watchFolders() { watchers.forEach(w => w.close()); watchers = Object.values(roots()).map(folder => { try { return fs.watch(folder, () => {}); } catch { return null; } }).filter(Boolean); }
function staticFile(requestPath, res) {
  const publicRoot = path.join(ROOT, "public"); const file = path.resolve(publicRoot, requestPath === "/" ? "index.html" : "." + requestPath);
  if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) return fail(res, 403, "FORBIDDEN", "Static path is not allowed");
  fs.readFile(file, (err, data) => { if (err) { const status = err.code === "ENOENT" ? 404 : 500; const code = err.code === "ENOENT" ? "NOT_FOUND" : "READ_FAILED"; if (status >= 500) logError({ method: "GET", url: requestPath }, status, code, err); return fail(res, status, code, "Static file could not be read"); } res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }); res.end(data); });
}
async function publicRevision() {
  const files = [];
  async function collect(folder) { for (const entry of await fsp.readdir(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); if (entry.isDirectory()) await collect(file); else files.push(file); } }
  await collect(path.join(ROOT, "public"));
  let latest = 0;
  for (const file of files) latest = Math.max(latest, (await fsp.stat(file)).mtimeMs);
  return String(Math.floor(latest));
}
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); const method = req.method;
  if (!url.pathname.startsWith("/api/")) return staticFile(url.pathname, res);
  if (method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, version: "1.0.0", timestamp: new Date().toISOString() });
  if (method === "GET" && url.pathname === "/api/revision") return json(res, 200, { ok: true, revision: await publicRevision() });
  if (method === "GET" && url.pathname === "/api/config") return json(res, 200, { ok: true, config });
  if (method === "POST" && url.pathname === "/api/config") { const body = await readBody(req); for (const key of ["projectDirectory", "importDirectory", "exportDirectory", "backupDirectory"]) if (body[key] !== undefined) config[key] = configuredDirectory(body[key]); if (body.autosaveIntervalSeconds !== undefined) { const seconds = Number(body.autosaveIntervalSeconds); if (!Number.isFinite(seconds) || seconds < 10) return fail(res, 400, "INVALID_AUTOSAVE_INTERVAL", "Autosave interval must be at least 10 seconds"); config.autosaveIntervalSeconds = seconds; } config.port = defaults.port; await ensureRoots(); await saveConfig(); watchFolders(); return json(res, 200, { ok: true, config }); }
  if (method === "GET" && url.pathname === "/api/projects") return json(res, 200, { ok: true, projects: await list("project", ".json"), autosaves: await list("backup", "-autosave.json") });
  if (method === "GET" && url.pathname === "/api/files") { const kind = url.searchParams.get("kind") || "import"; if (!roots()[kind]) return fail(res, 400, "INVALID_KIND", "Unknown file listing kind"); return json(res, 200, { ok: true, files: await list(kind), kind }); }
  const body = await readBody(req);
  if (method === "POST" && url.pathname === "/api/project/load") { const kind = body.kind === "backup" ? "backup" : "project"; const file = safePath(kind, body.path, [".json"]); return json(res, 200, { ok: true, project: JSON.parse(await fsp.readFile(file, "utf8")), path: path.basename(file), kind }); }
  if (method === "POST" && url.pathname === "/api/project/save") { const file = safePath("project", body.path || "untitled.json", [".json"]); const content = JSON.stringify(body.project || {}, null, 2) + "\n"; try { await backup(path.basename(file), await fsp.readFile(file, "utf8"), "project-backup.json"); } catch (e) { if (e.code !== "ENOENT") throw e; } await fsp.writeFile(file, content); return json(res, 200, { ok: true, path: path.basename(file) }); }
  if (method === "POST" && url.pathname === "/api/project/autosave") { const name = path.basename(body.path || "untitled.json", ".json") + ".autosave.json"; const saved = await backup(name, JSON.stringify(body.project || {}, null, 2) + "\n", "autosave.json"); return json(res, 200, { ok: true, backup: saved }); }
  if (method === "POST" && url.pathname === "/api/vmf/open") { const kind = body.kind === "export" ? "export" : "import"; const file = safePath(kind, body.path, [".vmf"]); return json(res, 200, { ok: true, path: path.basename(file), vmf: await fsp.readFile(file, "utf8") }); }
  if (method === "POST" && url.pathname === "/api/vmf/export") { const file = safePath("export", body.path || "prefab.vmf", [".vmf"]); const content = String(body.vmf || ""); if (!content.trim()) return fail(res, 400, "EMPTY_VMF", "VMF export content is empty"); try { await backup(path.basename(file), await fsp.readFile(file, "utf8"), "vmf-backup.vmf"); } catch (e) { if (e.code !== "ENOENT") throw e; } await fsp.writeFile(file, content); return json(res, 200, { ok: true, path: path.basename(file), bytes: Buffer.byteLength(content), id: crypto.randomUUID() }); }
  return fail(res, 404, "NOT_FOUND", "API endpoint was not found");
}
process.on("unhandledRejection", error => logError({}, 500, "UNHANDLED_REJECTION", error));
process.on("uncaughtException", error => { logError({}, 500, "UNCAUGHT_EXCEPTION", error); process.exitCode = 1; });
process.on("message", message => { if (message?.type === "shutdown") process.exit(0); });
loadConfig().then(() => {
  watchFolders();
  log("log", "Configuration loaded", `port=${config.port} project=${config.projectDirectory} export=${config.exportDirectory}`);
  const server = http.createServer((req, res) => {
    const started = Date.now();
    const requestId = crypto.randomUUID().slice(0, 8);
    res.once("finish", () => { if (req.url.startsWith("/api/") && req.url !== "/api/revision") log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "log", `${req.method} ${req.url}`, `id=${requestId} status=${res.statusCode} duration=${Date.now() - started}ms`); });
    route(req, res).catch(error => { const status = error.status || 500; const code = error.status ? "BAD_REQUEST" : "SERVER_ERROR"; logError(req, status, code, error); fail(res, status, code, error.message || "Unexpected server error"); });
  });
  let restarting = false;
  function listen() { server.listen(config.port, "127.0.0.1", () => { log("log", "Server listening", `url=http://localhost:${config.port}`); process.send?.({ type: "ready", port: config.port, pid: process.pid }); }); }
  server.on("error", error => { if (error.code === "EADDRINUSE") { log("warn", "Port still in use; retrying", `port=${config.port}`); setTimeout(listen, 500); return; } logError({}, 500, "SERVER_LISTEN_FAILED", error); });
  listen();
  if (!process.env.HAMMER_DEV) fs.watchFile(__filename, { interval: 500 }, (current, previous) => { if (restarting || current.mtimeMs === previous.mtimeMs) return; restarting = true; log("log", "server.js changed; restarting in place"); fs.unwatchFile(__filename); if (typeof server.closeAllConnections === "function") server.closeAllConnections(); server.close(() => { const child = spawn(process.execPath, [__filename], { cwd: ROOT, stdio: "inherit", windowsHide: true, detached: true }); child.unref(); child.once("error", error => logError({}, 500, "SERVER_RESTART_FAILED", error)); process.exit(0); }); });
}).catch(error => { logError({}, 500, "STARTUP_FAILED", error); process.exitCode = 1; });
