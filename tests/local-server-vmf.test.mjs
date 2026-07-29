import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { box } from "../public/js/geometry-model.js";
import { writeVMF } from "../public/js/vmf-writer.js";

const root = await mkdtemp(path.join(tmpdir(), "hammer-prefab-server-"));
const directories = {
  project: path.join(root, "projects"),
  import: path.join(root, "imports"),
  export: path.join(root, "exports"),
  backup: path.join(root, "backups"),
};
const child = fork(new URL("../server.js", import.meta.url), [], {
  silent: true,
  env: {
    ...process.env,
    HAMMER_PORT: "0",
    HAMMER_PROJECT_DIRECTORY: directories.project,
    HAMMER_IMPORT_DIRECTORY: directories.import,
    HAMMER_EXPORT_DIRECTORY: directories.export,
    HAMMER_BACKUP_DIRECTORY: directories.backup,
  },
});

try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local server timed out")),
      10000,
    );
    child.once("error", reject);
    child.on("message", (message) => {
      if (message?.type !== "ready") return;
      clearTimeout(timer);
      resolve(message.port);
    });
  });
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    assert.equal(response.ok, true, text);
    return JSON.parse(text);
  };
  assert.equal((await request("/api/health")).ok, true);
  const vmf = writeVMF([box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 })]);
  await request("/api/vmf/export", { path: "workflow.vmf", vmf });
  await request("/api/vmf/export", { path: "workflow.vmf", vmf });
  const opened = await request("/api/vmf/open", {
    path: "workflow.vmf",
    kind: "export",
  });
  assert.equal(opened.vmf, vmf);
  assert.equal(opened.path, "workflow.vmf");
  assert.equal(
    (await readdir(directories.backup)).filter((name) =>
      name.endsWith("vmf-backup.vmf"),
    ).length,
    1,
    "overwriting a local-server VMF creates one backup",
  );
  console.log("local server VMF open/save/backup passed");
} finally {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(root, { recursive: true, force: true });
}
