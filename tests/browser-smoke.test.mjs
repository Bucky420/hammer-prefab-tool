import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { box } from "../public/js/geometry-model.js";
import { writeRingPrefabVMF } from "../public/js/ring-export.js";
import { parseVMFDocument } from "../public/js/vmf-parser.js";
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
  if (relative === "legacy-sw.js") {
    response
      .writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end(
        'self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));',
      );
    return;
  }
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
    await page.addInitScript(() => {
      delete window.showOpenFilePicker;
      delete window.showSaveFilePicker;
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    assert.equal(await page.title(), "Untitled - Hammer Prefab Tool");
    assert.equal(await page.locator("#editor").count(), 1);
    assert.equal(await page.locator("#update-available").count(), 0);
    assert.deepEqual(pageErrors, []);

    await page.evaluate(async () => {
      await navigator.serviceWorker.register("./legacy-sw.js", { scope: "./" });
      const owned = await caches.open("hammer-prefab-tool-old");
      await owned.put(location.href, new Response("owned"));
      const unrelated = await caches.open("unrelated-cache");
      await unrelated.put(location.href, new Response("unrelated"));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const names = await caches.keys();
      return (
        registrations.length === 0 &&
        !names.includes("hammer-prefab-tool-old") &&
        names.includes("unrelated-cache")
      );
    });

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

    const droppedVmf = writeVMF([
      box({ x: 0, y: 0, z: 0 }, { x: 32, y: 32, z: 32 }),
      box({ x: 64, y: 0, z: 0 }, { x: 96, y: 32, z: 32 }),
    ]);
    await page.evaluate((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([text], "dropped.vmf", {
          type: "text/plain",
        }),
      );
      window.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, droppedVmf);
    await page
      .locator("#status")
      .filter({ hasText: "Opened dropped.vmf" })
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

    const vmfDownloadPromise = page.waitForEvent("download");
    await page.evaluate(() =>
      document.querySelector('[data-command="save-vmf"]').click(),
    );
    const vmfDownload = await vmfDownloadPromise;
    assert.equal(vmfDownload.suggestedFilename(), "dropped.vmf");
    await page
      .locator("#dirty-indicator")
      .filter({ hasText: "Saved" })
      .waitFor();

    await page.locator('[data-tool-mode="path"]').click();
    const editorBounds = await page.locator("#editor").boundingBox();
    assert.ok(editorBounds, "editor canvas has measurable bounds");
    const pathY = editorBounds.y + editorBounds.height / 2;
    await page.mouse.click(editorBounds.x + editorBounds.width / 2 - 64, pathY);
    await page.mouse.click(editorBounds.x + editorBounds.width / 2 + 64, pathY);
    await page.keyboard.press("Enter");
    await page
      .locator("#status")
      .filter({ hasText: "Created hallway: 8 convex brushes" })
      .waitFor();
    await page.locator("#stats").filter({ hasText: "10 brushes" }).waitFor();
    await page.locator('[data-tool-mode="selection"]').click();
    await page.locator('[data-tool-mode="path"]').click();
    await page.locator("#stats").filter({ hasText: "2 path nodes" }).waitFor();
    await page.evaluate(() => document.querySelector("#view-selector").click());
    await page.evaluate(() => document.querySelector("#view-selector").click());
    await page.mouse.move(editorBounds.x + editorBounds.width / 2 + 64, pathY);
    await page.mouse.down();
    await page.mouse.move(
      editorBounds.x + editorBounds.width / 2 + 64,
      pathY - 32,
    );
    await page.mouse.up();
    await page.keyboard.press("Enter");
    await page
      .locator("#status")
      .filter({ hasText: "Updated hallway: 8 convex brushes" })
      .waitFor();
    await page.locator("#stats").filter({ hasText: "10 brushes" }).waitFor();
    assert.deepEqual(pageErrors, []);

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

    const pathPage = await browser.newPage();
    const pathErrors = [];
    pathPage.on("pageerror", (error) => pathErrors.push(error));
    await pathPage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    const sourceFloor = writeVMF([
      box({ x: -32, y: -32, z: -8 }, { x: 32, y: 32, z: 0 }),
    ]);
    await pathPage.locator("#vmf-file-input").setInputFiles({
      name: "hallway-source.vmf",
      mimeType: "text/plain",
      buffer: Buffer.from(sourceFloor),
    });
    await pathPage
      .locator("#status")
      .filter({ hasText: "Opened hallway-source.vmf" })
      .waitFor();
    const pathBounds = await pathPage.locator("#editor").boundingBox();
    assert.ok(pathBounds);
    const pathCenter = {
      x: pathBounds.x + pathBounds.width / 2,
      y: pathBounds.y + pathBounds.height / 2,
    };
    await pathPage.mouse.click(pathCenter.x, pathCenter.y);
    await pathPage
      .locator("#stats")
      .filter({ hasText: "1 selected objects" })
      .waitFor();
    await pathPage.locator('[data-tool-mode="path"]').click();
    const expandedPathBounds = await pathPage.locator("#editor").boundingBox();
    assert.ok(expandedPathBounds);
    pathCenter.x = expandedPathBounds.x + expandedPathBounds.width / 2;
    pathCenter.y = expandedPathBounds.y + expandedPathBounds.height / 2;
    for (const [x, y] of [
      [expandedPathBounds.x + expandedPathBounds.width - 40, pathCenter.y],
      [expandedPathBounds.x + 260, pathCenter.y],
      [pathCenter.x, expandedPathBounds.y + 40],
      [pathCenter.x, expandedPathBounds.y + expandedPathBounds.height - 40],
    ]) {
      await pathPage.mouse.move(x, y);
      await pathPage.mouse.click(x, y);
      if ((await pathPage.locator("#stats").textContent()).includes("2 path nodes"))
        break;
    }
    await pathPage.locator("#stats").filter({ hasText: "2 path nodes" }).waitFor();
    assert.equal(
      await pathPage.locator('[data-path-setting="interiorWidth"]').inputValue(),
      "32",
      "selected floor outside width defines the clear hallway width",
    );
    await pathPage.keyboard.press("Enter");
    await pathPage
      .locator("#status")
      .filter({ hasText: /Created hallway: \d+ convex brushes/ })
      .waitFor();
    assert.deepEqual(pathErrors, []);
    await pathPage.close();

    const brushPage = await browser.newPage();
    const brushErrors = [];
    brushPage.on("pageerror", (error) => brushErrors.push(error));
    await brushPage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    await brushPage.locator('[data-tool-mode="brush"]').click();
    const brushBounds = await brushPage.locator("#editor").boundingBox();
    assert.ok(brushBounds);
    const brushCenter = {
      x: brushBounds.x + brushBounds.width / 2,
      y: brushBounds.y + brushBounds.height / 2,
    };
    await brushPage.mouse.move(brushCenter.x - 64, brushCenter.y - 64);
    await brushPage.mouse.down();
    await brushPage.mouse.move(brushCenter.x + 64, brushCenter.y + 64);
    await brushPage.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    const previewPixel = await brushPage.locator("#editor").evaluate((canvas) => {
      const context = canvas.getContext("2d");
      return Array.from(
        context.getImageData(
          canvas.width / 2 + 13,
          canvas.height / 2 + 13,
          1,
          1,
        ).data,
      );
    });
    assert.ok(
      previewPixel[0] > previewPixel[2] + 10,
      `brush geometry is visibly previewed before pointer release: ${previewPixel}`,
    );
    await brushPage.mouse.up();
    await brushPage.keyboard.press("Enter");
    await brushPage.locator("#stats").filter({ hasText: "1 brush" }).waitFor();
    assert.deepEqual(brushErrors, []);
    await brushPage.close();

    const closedPathPage = await browser.newPage();
    const closedPathErrors = [];
    closedPathPage.on("pageerror", (error) => closedPathErrors.push(error));
    await closedPathPage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    await closedPathPage.locator('[data-tool-mode="path"]').click();
    await closedPathPage
      .locator('[data-path-setting="interiorWidth"]')
      .fill("32");
    await closedPathPage
      .locator('[data-path-setting="interiorWidth"]')
      .dispatchEvent("change");
    const closedBounds = await closedPathPage.locator("#editor").boundingBox();
    assert.ok(closedBounds);
    const closedCenter = {
      x: closedBounds.x + closedBounds.width / 2,
      y: closedBounds.y + closedBounds.height / 2,
    };
    for (const [x, y] of [
      [-192, -192],
      [192, -192],
      [192, 192],
      [-192, 192],
    ])
      await closedPathPage.mouse.click(closedCenter.x + x, closedCenter.y + y);
    await closedPathPage.evaluate(() =>
      document.querySelector("[data-path-close]").click(),
    );
    await closedPathPage
      .locator("#status")
      .filter({ hasText: "Hallway path closed" })
      .waitFor();
    await closedPathPage.keyboard.press("Backspace");
    await closedPathPage.locator("#stats").filter({ hasText: "3 path nodes" }).waitFor();
    await closedPathPage.mouse.click(closedCenter.x - 192, closedCenter.y + 192);
    await closedPathPage.locator("#stats").filter({ hasText: "4 path nodes" }).waitFor();
    await closedPathPage.evaluate(() =>
      document.querySelector("[data-path-close]").click(),
    );
    await closedPathPage
      .locator("#status")
      .filter({ hasText: "Hallway path closed" })
      .waitFor();
    await closedPathPage.keyboard.press("Enter");
    await closedPathPage
      .locator("#status")
      .filter({ hasText: /Created hallway: \d+ convex brushes/ })
      .waitFor();
    assert.deepEqual(closedPathErrors, []);
    await closedPathPage.close();

    const handlePage = await browser.newPage();
    const linkedPrefab = writeRingPrefabVMF([
      box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }),
    ]);
    await handlePage.addInitScript((vmfText) => {
      window.__fileWorkflow = {
        openWrites: [],
        saveAsWrites: [],
        savePickerCalls: 0,
      };
      const writable = (target) => ({
        write: async (value) => target.push(String(value)),
        close: async () => {},
      });
      const openHandle = {
        name: "linked-prefab.vmf",
        getFile: async () =>
          new File(
            [window.__fileWorkflow.openText || vmfText],
            "linked-prefab.vmf",
            { type: "text/plain", lastModified: Date.now() },
          ),
        createWritable: async () => writable(window.__fileWorkflow.openWrites),
      };
      window.showOpenFilePicker = async () => [openHandle];
      window.showSaveFilePicker = async () => {
        window.__fileWorkflow.savePickerCalls++;
        return {
          name: "new-prefab.vmf",
          getFile: async () =>
            new File(
              [window.__fileWorkflow.saveAsWrites.at(-1) || vmfText],
              "new-prefab.vmf",
              { type: "text/plain", lastModified: Date.now() },
            ),
          createWritable: async () =>
            writable(window.__fileWorkflow.saveAsWrites),
        };
      };
    }, linkedPrefab);
    await handlePage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    await handlePage.evaluate(() =>
      document.querySelector("[data-generate]").click(),
    );
    await handlePage.evaluate(() => {
      const ownership = document.querySelector("[data-prefab-ownership]");
      ownership.value = "group";
      ownership.dispatchEvent(new Event("change", { bubbles: true }));
      const backing = document.querySelector("[data-prefab-backing]");
      backing.value = "floor";
      backing.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await handlePage.evaluate(() =>
      document.querySelector('[data-command="save-vmf-as"]').click(),
    );
    await handlePage
      .locator("#status")
      .filter({ hasText: "Saved VMF new-prefab.vmf" })
      .waitFor();
    assert.equal(
      await handlePage.evaluate(() => window.__fileWorkflow.savePickerCalls),
      1,
      "explicit Save As invokes the picker",
    );
    const firstGroupSave = await handlePage.evaluate(
      () => window.__fileWorkflow.saveAsWrites[0],
    );
    await handlePage.evaluate(() => {
      window.__fileWorkflow.openText = window.__fileWorkflow.saveAsWrites[0];
    });
    await handlePage.evaluate(() =>
      document.querySelector('[data-command="open-vmf"]').click(),
    );
    await handlePage
      .locator("#status")
      .filter({ hasText: "Opened linked-prefab.vmf" })
      .waitFor();
    await handlePage.evaluate(() =>
      document.querySelector('[data-command="save-vmf"]').click(),
    );
    await handlePage
      .locator("#status")
      .filter({ hasText: "Saved VMF linked-prefab.vmf" })
      .waitFor();
    assert.equal(
      await handlePage.evaluate(() => window.__fileWorkflow.openWrites.length),
      1,
      "Save writes an opened prefab through its retained handle",
    );
    assert.match(
      await handlePage.evaluate(() => window.__fileWorkflow.openWrites[0]),
      /"prefab"\s+"1"/,
      "direct Save writes a Hammer prefab VMF",
    );
    assert.match(
      await handlePage.evaluate(() => window.__fileWorkflow.openWrites[0]),
      /"hammer_prefab_ownership"\s+"group"/,
      "prefab ownership settings survive in the VMF",
    );
    const secondGroupSave = await handlePage.evaluate(
      () => window.__fileWorkflow.openWrites[0],
    );
    for (const saved of [firstGroupSave, secondGroupSave]) {
      const savedDocument = parseVMFDocument(saved);
      assert.equal(
        savedDocument.world.brushes.filter(
          (brush) => brush.editor?.keys?.hammer_prefab_backing === "1",
        ).length,
        1,
        "repeated Hammer-group saves retain exactly one shared backing",
      );
    }
    assert.equal(
      await handlePage.evaluate(() => window.__fileWorkflow.savePickerCalls),
      1,
      "direct Save does not invoke another Save As picker",
    );
    await handlePage.close();
    console.log("hosted browser smoke passed");
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
