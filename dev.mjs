import { fork } from "node:child_process";
import { once } from "node:events";
import chokidar from "chokidar";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIRECTORY = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIRECTORY, "dev.log");
mkdirSync(LOG_DIRECTORY, { recursive: true });
const consoleMethods = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
for (const [level, write] of Object.entries(consoleMethods)) console[level] = (...args) => { const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(" ")}`; write(...args); appendFileSync(LOG_FILE, `${line}\n`); };
const SERVER_FILE = path.join(ROOT, "server.js");
const BACKEND_PORT = 8788;
let viteServer;
let backend;
let intentionalStop = null;
let watcher;
let stopping = false;
let restartTimer;
let restartChain = Promise.resolve();

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Backend startup timed out.")); }, 10000);
    const cleanup = () => { clearTimeout(timeout); child.off("message", onMessage); child.off("error", onError); child.off("exit", onExit); };
    const onMessage = message => { if (message?.type !== "ready") return; cleanup(); resolve(message); };
    const onError = error => { cleanup(); reject(error); };
    const onExit = (code, signal) => { cleanup(); reject(new Error(`Backend exited before ready: code=${code}, signal=${signal}`)); };
    child.on("message", onMessage); child.once("error", onError); child.once("exit", onExit);
  });
}

async function startBackend() {
  if (stopping || backend) return;
  const child = fork(SERVER_FILE, [], { cwd: ROOT, env: { ...process.env, HAMMER_DEV: "1", HAMMER_PORT: String(BACKEND_PORT) }, stdio: ["inherit", "inherit", "inherit", "ipc"], windowsHide: false });
  backend = child;
  child.on("exit", (code, signal) => { const intentional = stopping || intentionalStop === child; if (backend === child) backend = null; if (!intentional) { console.error(`[dev] Backend exited: code=${code}, signal=${signal}`); scheduleRestart("unexpected backend exit", 500); } if (intentionalStop === child) intentionalStop = null; });
  const ready = await waitForReady(child);
  console.log(`[dev] Backend ready at http://127.0.0.1:${ready.port}`);
}

async function stopBackend() {
  const child = backend;
  if (!child || child.exitCode !== null) { backend = null; return; }
  backend = null;
  intentionalStop = child;
  const exited = once(child, "exit").catch(() => undefined);
  if (child.connected) child.send({ type: "shutdown" }); else child.kill();
  const force = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 5000);
  force.unref?.();
  await exited;
  clearTimeout(force);
}

async function restartBackend(reason) { console.log(`[dev] Restarting backend: ${reason}`); await stopBackend(); await startBackend(); }
function scheduleRestart(reason, delay = 150) { if (stopping) return; clearTimeout(restartTimer); restartTimer = setTimeout(() => { restartChain = restartChain.then(() => restartBackend(reason)).catch(error => console.error("[dev] Backend restart failed:", error)); }, delay); }

async function shutdown(code = 0) { if (stopping) return; stopping = true; clearTimeout(restartTimer); await watcher?.close(); await stopBackend(); await viteServer?.close(); process.exit(code); }
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.once("uncaughtException", error => { console.error(error); void shutdown(1); });
process.once("unhandledRejection", error => { console.error(error); void shutdown(1); });

try {
  await startBackend();
  viteServer = await createViteServer({ configFile: path.join(ROOT, "vite.config.mjs") });
  await viteServer.listen();
  viteServer.printUrls();
  watcher = chokidar.watch([SERVER_FILE], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 125, pollInterval: 25 } });
  watcher.on("all", (event, file) => scheduleRestart(`${event}: ${path.relative(ROOT, file)}`));
  watcher.on("error", error => console.error("[dev] Backend watcher error:", error));
  console.log("[dev] Frontend HMR enabled.");
} catch (error) {
  console.error("[dev] Startup failed:", error);
  await shutdown(1);
}
