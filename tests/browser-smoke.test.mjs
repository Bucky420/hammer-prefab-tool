import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { box } from "../public/js/geometry-model.js";
import { generateRing } from "../public/js/ring-generator.js";
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
    await page.locator("[data-path-avoid]").uncheck();
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

    const sourceRoutePage = await browser.newPage();
    const sourceRouteErrors = [];
    sourceRoutePage.on("pageerror", (error) => sourceRouteErrors.push(error));
    await sourceRoutePage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    const sourceMouth = [
      box({ x: 1027, y: 0, z: -64 }, { x: 1523, y: 200, z: 0 }),
      box({ x: 1027, y: -200, z: -64 }, { x: 1523, y: 0, z: 0 }),
    ];
    const nearbyWall = generateRing({
      radius: 349,
      width: 70,
      height: 128,
      segments: 32,
      grid: 1,
    });
    nearbyWall.forEach((brush) =>
      brush.vertices.forEach((vertex) => {
        vertex.x += 2432;
      }),
    );
    const sourceRouteBrushes = [
      ...sourceMouth,
      ...nearbyWall,
      box({ x: 3984, y: -16, z: -64 }, { x: 4016, y: 16, z: 0 }),
    ];
    await sourceRoutePage.locator("#vmf-file-input").setInputFiles({
      name: "failtest4-source-mouth.vmf",
      mimeType: "text/plain",
      buffer: Buffer.from(writeVMF(sourceRouteBrushes)),
    });
    await sourceRoutePage
      .locator("#status")
      .filter({ hasText: "Opened failtest4-source-mouth.vmf" })
      .waitFor();
    const sourceRouteBounds = await sourceRoutePage
      .locator("#editor")
      .boundingBox();
    assert.ok(sourceRouteBounds);
    const sourceGeometry = sourceRouteBrushes.flatMap((brush) => brush.vertices);
    const sourceMinX = Math.min(...sourceGeometry.map((vertex) => vertex.x));
    const sourceMaxX = Math.max(...sourceGeometry.map((vertex) => vertex.x));
    const sourceMinY = Math.min(...sourceGeometry.map((vertex) => vertex.y));
    const sourceMaxY = Math.max(...sourceGeometry.map((vertex) => vertex.y));
    const sourceScale = Math.min(
      16,
      (sourceRouteBounds.width - 72) / Math.max(1, sourceMaxX - sourceMinX),
      (sourceRouteBounds.height - 72) / Math.max(1, sourceMaxY - sourceMinY),
    );
    const sourceOffsetX = (-(sourceMinX + sourceMaxX) * sourceScale) / 2;
    const sourceOffsetY = ((sourceMinY + sourceMaxY) * sourceScale) / 2;
    const sourceScreen = (x, y) => ({
      x:
        sourceRouteBounds.x +
        sourceRouteBounds.width / 2 +
        x * sourceScale +
        sourceOffsetX,
      y:
        sourceRouteBounds.y +
        sourceRouteBounds.height / 2 -
        y * sourceScale +
        sourceOffsetY,
    });
    const upperSource = sourceScreen(1275, 100);
    const lowerSource = sourceScreen(1275, -100);
    await sourceRoutePage.mouse.click(upperSource.x, upperSource.y);
    await sourceRoutePage.keyboard.down("Control");
    await sourceRoutePage.mouse.click(lowerSource.x, lowerSource.y);
    await sourceRoutePage.keyboard.up("Control");
    await sourceRoutePage
      .locator("#stats")
      .filter({ hasText: "2 selected objects" })
      .waitFor();
    await sourceRoutePage.locator('[data-tool-mode="path"]').click();
    await sourceRoutePage.locator("[data-path-snap]").uncheck();
    await sourceRoutePage
      .locator('[data-path-setting="maxSegmentLength"]')
      .fill("256");
    const expandedSourceBounds = await sourceRoutePage
      .locator("#editor")
      .boundingBox();
    assert.ok(expandedSourceBounds);
    const activeSourceScreen = (x, y) => ({
      x:
        expandedSourceBounds.x +
        expandedSourceBounds.width / 2 +
        x * sourceScale +
        sourceOffsetX,
      y:
        expandedSourceBounds.y +
        expandedSourceBounds.height / 2 -
        y * sourceScale +
        sourceOffsetY,
    });
    const blockedStart = activeSourceScreen(1800, 0);
    await sourceRoutePage.mouse.click(blockedStart.x, blockedStart.y);
    await sourceRoutePage
      .locator("#stats")
      .filter({ hasText: "1 path nodes" })
      .waitFor();
    const formerTangentHandle = activeSourceScreen(1431, 0);
    await sourceRoutePage.mouse.click(
      formerTangentHandle.x,
      formerTangentHandle.y,
    );
    await sourceRoutePage
      .locator("#stats")
      .filter({ hasText: "2 path nodes" })
      .waitFor();
    await sourceRoutePage.keyboard.press("Backspace");
    await sourceRoutePage
      .locator("#stats")
      .filter({ hasText: "1 path nodes" })
      .waitFor();
    const routedEnd = activeSourceScreen(4000, 0);
    await sourceRoutePage.mouse.click(routedEnd.x, routedEnd.y);
    await sourceRoutePage.waitForFunction(() => {
      const match = document
        .querySelector("#stats")
        .textContent.match(/(\d+) path nodes/);
      return Number(match?.[1]) > 4;
    });
    await sourceRoutePage.keyboard.press("Enter");
    await sourceRoutePage
      .locator("#status")
      .filter({ hasText: /Created hallway: \d+ convex brushes/ })
      .waitFor({ timeout: 15000 });
    assert.deepEqual(sourceRouteErrors, []);
    await sourceRoutePage.close();

    const routePage = await browser.newPage();
    const routeErrors = [];
    routePage.on("pageerror", (error) => routeErrors.push(error));
    await routePage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    const routeBrushes = [0, 2432].flatMap((centerX) => {
      const ring = generateRing({
        radius: 349,
        width: 70,
        height: 128,
        segments: 32,
        grid: 1,
      });
      ring.forEach((brush) =>
        brush.vertices.forEach((vertex) => {
          vertex.x += centerX;
        }),
      );
      return ring;
    });
    routeBrushes.push(
      box({ x: 1520, y: -16, z: -64 }, { x: 1552, y: 16, z: 0 }),
      box({ x: 3184, y: -16, z: -64 }, { x: 3216, y: 16, z: 0 }),
    );
    await routePage.locator("#vmf-file-input").setInputFiles({
      name: "failtest4-routing.vmf",
      mimeType: "text/plain",
      buffer: Buffer.from(writeVMF(routeBrushes)),
    });
    await routePage
      .locator("#status")
      .filter({ hasText: "Opened failtest4-routing.vmf" })
      .waitFor();
    const routeBounds = await routePage.locator("#editor").boundingBox();
    assert.ok(routeBounds);
    const geometryBounds = routeBrushes.flatMap((brush) => brush.vertices);
    const minX = Math.min(...geometryBounds.map((vertex) => vertex.x));
    const maxX = Math.max(...geometryBounds.map((vertex) => vertex.x));
    const minY = Math.min(...geometryBounds.map((vertex) => vertex.y));
    const maxY = Math.max(...geometryBounds.map((vertex) => vertex.y));
    const routeScale = Math.min(
      16,
      (routeBounds.width - 72) / Math.max(1, maxX - minX),
      (routeBounds.height - 72) / Math.max(1, maxY - minY),
    );
    const routeOffsetX = (-(minX + maxX) * routeScale) / 2;
    const routeOffsetY = ((minY + maxY) * routeScale) / 2;
    const routeScreen = (x, y) => ({
      x: routeBounds.x + routeBounds.width / 2 + x * routeScale + routeOffsetX,
      y: routeBounds.y + routeBounds.height / 2 - y * routeScale + routeOffsetY,
    });
    await routePage.mouse.click(...Object.values(routeScreen(314, 0)));
    await routePage.keyboard.down("Control");
    await routePage.mouse.click(...Object.values(routeScreen(0, 314)));
    await routePage.mouse.click(...Object.values(routeScreen(-314, 0)));
    await routePage.keyboard.up("Control");
    await routePage
      .locator("#stats")
      .filter({ hasText: "3 selected objects" })
      .waitFor();
    await routePage.locator('[data-tool-mode="path"]').click();
    await routePage
      .locator("#status")
      .filter({ hasText: "cannot define one hallway mouth; starting a free path" })
      .waitFor();
    await routePage.locator("[data-path-snap]").uncheck();
    await routePage.locator('[data-path-setting="interiorWidth"]').fill("128");
    await routePage.locator('[data-path-setting="routeMargin"]').fill("32");
    await routePage
      .locator('[data-path-setting="maxSegmentLength"]')
      .fill("256");
    const routeStart = routeScreen(1536, 0);
    const routeEnd = routeScreen(3200, 0);
    await routePage.mouse.click(routeStart.x, routeStart.y);
    await routePage.mouse.click(routeEnd.x, routeEnd.y);
    await routePage.waitForFunction(() => {
      const match = document
        .querySelector("#stats")
        .textContent.match(/(\d+) path nodes/);
      return Number(match?.[1]) > 4;
    });
    await routePage.keyboard.press("Enter");
    await routePage
      .locator("#status")
      .filter({ hasText: /Created hallway: \d+ convex brushes/ })
      .waitFor({ timeout: 15000 });
    assert.deepEqual(routeErrors, []);
    await routePage.close();

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

    const primitivePage = await browser.newPage();
    const primitiveErrors = [];
    primitivePage.on("pageerror", (error) => primitiveErrors.push(error));
    await primitivePage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    await primitivePage.locator('[data-tool-mode="brush"]').click();
    await primitivePage.locator("[data-shape]").selectOption("sphere");
    assert.equal(
      await primitivePage.locator('[data-setting="segments"]').inputValue(),
      "8",
      "Sphere keeps its own subdivision count",
    );
    await primitivePage.locator("[data-shape]").selectOption("cylinder");
    assert.equal(
      await primitivePage.locator('[data-setting="segments"]').inputValue(),
      "32",
      "Cylinder restores its independent side count after Sphere",
    );
    assert.equal(
      await primitivePage.locator("[data-generate]").count(),
      0,
      "primitive creation stays on the grid instead of using a panel action",
    );
    await primitivePage.evaluate(() =>
      document.querySelector("#view-selector").click(),
    );
    await primitivePage.evaluate(() =>
      document.querySelector("#view-selector").click(),
    );
    const primitiveBounds = await primitivePage.locator("#editor").boundingBox();
    assert.ok(primitiveBounds);
    const primitiveCenter = {
      x: primitiveBounds.x + primitiveBounds.width / 2,
      y: primitiveBounds.y + primitiveBounds.height / 2,
    };
    await primitivePage.mouse.move(
      primitiveCenter.x - 96,
      primitiveCenter.y - 96,
    );
    await primitivePage.mouse.down();
    await primitivePage.mouse.move(
      primitiveCenter.x + 96,
      primitiveCenter.y + 96,
    );
    await primitivePage.mouse.up();
    assert.equal(
      await primitivePage.locator('[data-setting="radius"]').inputValue(),
      "96",
      "dragged primitive footprint updates its editable radius",
    );
    await primitivePage.mouse.move(
      primitiveCenter.x,
      primitiveCenter.y - 96,
    );
    await primitivePage.mouse.down();
    await primitivePage.mouse.move(
      primitiveCenter.x,
      primitiveCenter.y - 128,
    );
    await primitivePage.mouse.up();
    assert.equal(
      await primitivePage.locator('[data-setting="radius"]').inputValue(),
      "128",
      "the on-grid size handle resizes the staged primitive",
    );
    await primitivePage.keyboard.press("Enter");
    await primitivePage
      .locator("#status")
      .filter({ hasText: "Cylinder created: 1 brush solid" })
      .waitFor();
    await primitivePage.evaluate(() =>
      document.querySelector('[data-command="validate"]').click(),
    );
    await primitivePage
      .locator("#status")
      .filter({ hasText: "Validated 1 brush solids" })
      .waitFor();
    assert.deepEqual(primitiveErrors, []);
    await primitivePage.close();

    const archPage = await browser.newPage();
    const archErrors = [];
    archPage.on("pageerror", (error) => archErrors.push(error));
    await archPage.goto(`http://127.0.0.1:${port}${prefix}`, {
      waitUntil: "networkidle",
    });
    await archPage.locator('[data-tool-mode="brush"]').click();
    await archPage.locator("[data-shape]").selectOption("arch");
    const archBounds = await archPage.locator("#editor").boundingBox();
    assert.ok(archBounds);
    const archCenter = {
      x: archBounds.x + archBounds.width / 2,
      y: archBounds.y + archBounds.height / 2,
    };
    await archPage.mouse.move(archCenter.x - 192, archCenter.y - 192);
    await archPage.mouse.down();
    await archPage.mouse.move(archCenter.x + 192, archCenter.y + 192);
    await archPage.mouse.up();
    await archPage.mouse.move(archCenter.x + 128, archCenter.y);
    await archPage.mouse.down();
    await archPage.mouse.move(
      archCenter.x + Math.SQRT1_2 * 96,
      archCenter.y - Math.SQRT1_2 * 96,
    );
    await archPage.mouse.up();
    assert.equal(
      await archPage.locator('[data-setting="width"]').inputValue(),
      "96",
      "pink Thickness handle responds to radial movement",
    );
    await archPage.mouse.move(archCenter.x - 192, archCenter.y);
    await archPage.mouse.down();
    const nearNinety = (87 * Math.PI) / 180;
    await archPage.mouse.move(
      archCenter.x + Math.cos(nearNinety) * 192,
      archCenter.y - Math.sin(nearNinety) * 192,
    );
    await archPage.mouse.up();
    assert.equal(
      await archPage.locator('[data-setting="arc"]').inputValue(),
      "90",
      "Arc handle magnetically snaps near 90 degrees",
    );
    await archPage.mouse.move(archCenter.x, archCenter.y - 192);
    await archPage.mouse.down();
    const nearFullCircle = (357 * Math.PI) / 180;
    await archPage.mouse.move(
      archCenter.x + Math.cos(nearFullCircle) * 192,
      archCenter.y - Math.sin(nearFullCircle) * 192,
    );
    await archPage.mouse.up();
    assert.equal(
      await archPage.locator('[data-setting="arc"]').inputValue(),
      "360",
      "Arc handle snaps to its full-circle endpoint",
    );
    assert.deepEqual(archErrors, []);
    await archPage.close();

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
    await handlePage.locator('[data-tool-mode="brush"]').click();
    const handleEditorBounds = await handlePage.locator("#editor").boundingBox();
    assert.ok(handleEditorBounds);
    const handleEditorCenter = {
      x: handleEditorBounds.x + handleEditorBounds.width / 2,
      y: handleEditorBounds.y + handleEditorBounds.height / 2,
    };
    await handlePage.mouse.move(
      handleEditorCenter.x - 64,
      handleEditorCenter.y - 64,
    );
    await handlePage.mouse.down();
    await handlePage.mouse.move(
      handleEditorCenter.x + 64,
      handleEditorCenter.y + 64,
    );
    await handlePage.mouse.up();
    await handlePage.keyboard.press("Enter");
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
