import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { box } from "../public/js/geometry-model.js";
import {
  createProject,
  serializeProject,
} from "../public/js/project-format.js";
import { writeVMF } from "../public/js/vmf-writer.js";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const prefix = "/hammer-prefab-tool/";
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  const relative = request.url.startsWith(prefix)
    ? request.url.slice(prefix.length).split("?")[0] || "index.html"
    : "";
  const file = path.resolve(dist, relative);
  if (
    !relative ||
    !file.startsWith(`${dist}${path.sep}`) ||
    !fs.existsSync(file)
  ) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type":
      contentTypes[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
let browser;

try {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (process.env.CI || process.env.HPT_REQUIRE_BROWSER) throw error;
    console.log(
      "hosted browser smoke skipped: run `npx playwright install chromium` to enable it",
    );
    process.exitCode = 0;
  }
  if (browser) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    assert.equal(await page.title(), "Untitled - Hammer Prefab Tool");
    assert.equal(await page.locator("#editor").count(), 1);
    assert.deepEqual(pageErrors, []);

    const vmf = writeVMF([box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 })]);
    await page.locator("#vmf-file-input").setInputFiles({
      name: "browser-input.vmf",
      mimeType: "text/plain",
      buffer: Buffer.from(vmf),
    });
    await page
      .locator("#status")
      .filter({ hasText: "Opened browser-input.vmf" })
      .waitFor();
    await page.locator("#stats").filter({ hasText: "1 brush" }).waitFor();

    const projectDownloadPromise = page.waitForEvent("download");
    await page.locator('[data-menu="file-menu"]').click();
    await page.locator('[data-command="save-project-download"]').click();
    const projectDownload = await projectDownloadPromise;
    assert.match(projectDownload.suggestedFilename(), /\.hptproject\.json$/);

    const droppedProject = serializeProject(
      createProject({
        projectName: "Dropped project",
        brushes: [
          box({ x: 0, y: 0, z: 0 }, { x: 32, y: 32, z: 32 }),
          box({ x: 64, y: 0, z: 0 }, { x: 96, y: 32, z: 32 }),
        ],
      }),
    );
    await page.evaluate((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([text], "dropped.hptproject.json", {
          type: "application/json",
        }),
      );
      window.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, droppedProject);
    await page
      .locator("#status")
      .filter({ hasText: "Opened dropped.hptproject.json" })
      .waitFor();
    await page.locator("#stats").filter({ hasText: "2 brushes" }).waitFor();

    await page.locator("#vmf-file-input").setInputFiles({
      name: "broken.vmf",
      mimeType: "text/plain",
      buffer: Buffer.from('world { "id" "1"'),
    });
    await page
      .locator("#status")
      .filter({ hasText: "VMF parse error" })
      .waitFor();
    await page.locator("#stats").filter({ hasText: "2 brushes" }).waitFor();

    await page.locator('[data-menu="view-menu"]').click();
    await page.locator("#grid").selectOption("8");
    await page
      .locator("#autosave-status")
      .filter({ hasText: "Autosaved" })
      .waitFor({ timeout: 10000 });
    const autosaveCount = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("hammer-prefab-tool", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const request = open.result
              .transaction("project-snapshots", "readonly")
              .objectStore("project-snapshots")
              .count();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          };
        }),
    );
    assert.ok(autosaveCount > 0);

    await page.evaluate(() => {
      const input = document.querySelector("#vmf-filename");
      input.value = "browser-export";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const vmfDownloadPromise = page.waitForEvent("download");
    await page.evaluate(() =>
      document.querySelector('[data-command="export-vmf"]').click(),
    );
    const vmfDownload = await vmfDownloadPromise;
    assert.equal(vmfDownload.suggestedFilename(), "browser-export.vmf");
    await page
      .locator("#dirty-indicator")
      .filter({ hasText: "Saved" })
      .waitFor();

    assert.ok(requests.some((request) => /\/assets\/.*\.js/.test(request)));
    assert.ok(requests.some((request) => /\/assets\/.*\.css/.test(request)));
    assert.equal(
      requests.some((request) => request.startsWith("/api/")),
      false,
    );
    assert.equal(
      requests.some((request) => request.includes("/_deps/")),
      false,
    );
    console.log("hosted browser smoke passed");
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
