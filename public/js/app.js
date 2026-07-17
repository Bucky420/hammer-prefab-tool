import { HP } from "./namespace.js";
import { api } from "./api.js";
import { box, clone, snapAllVertices, countOffGridCoordinates } from "./geometry-model.js";
import { generateRing } from "./ring-generator.js";
import { validateAll } from "./brush-validation.js";
import { History } from "./history.js";
import { Viewport } from "./viewport.js";
import { writeVMF } from "./vmf-writer.js";
import { parseVMF } from "./vmf-parser.js";
import { alignAllFacesToCenter, alignAllFacesToOuter } from "./texture-alignment.js";
import { GRID_VALUES, roundToGrid } from "./grid.js";
import { ringVertexIds } from "./selection.js";
import { nudge, scaleVertices, setRingRadius, selectionBounds } from "./vertex-editor.js";

const $ = id => document.getElementById(id);
const state = HP.state;
const history = state.history || (state.history = new History());
const status = $("status");
document.querySelector(".live-indicator")?.remove();
const hmrIndicator = document.createElement("span");
hmrIndicator.className = "live-indicator";
hmrIndicator.dataset.state = "connecting";
hmrIndicator.title = "Development reload connecting";
document.querySelector("header").append(hmrIndicator);
window.addEventListener("error", event => { if (status) setTimeout(() => setStatus(`UI error: ${event.message}`, true), 0); });
window.addEventListener("unhandledrejection", event => { if (status) setTimeout(() => setStatus(`UI error: ${event.reason?.message || event.reason}`, true), 0); });
const browser = $("project-browser");
const search = $("file-search");
const viewNames = ["top", "front", "side"];
const viewLabels = { top: "TOP / XY", front: "FRONT / YZ", side: "SIDE / XZ" };
let activeView = state.view || "top";
const view = new Viewport($("editor"), activeView, state, changeType => changeType === "selection-commit" ? changed() : changeType ? redraw() : changed(), bounds => { const [horizontal, vertical, depth] = bounds.axes; const min = { x: 0, y: 0, z: 0 }, max = { x: 0, y: 0, z: 0 }; min[horizontal] = Math.min(bounds.start[horizontal], bounds.end[horizontal]); max[horizontal] = Math.max(bounds.start[horizontal], bounds.end[horizontal]); min[vertical] = Math.min(bounds.start[vertical], bounds.end[vertical]); max[vertical] = Math.max(bounds.start[vertical], bounds.end[vertical]); const depthSize = depth === "x" ? state.generator.width : depth === "y" ? brushDepth : state.generator.height; min[depth] = depth === "z" ? state.generator.addHeight : -depthSize / 2; max[depth] = depth === "z" ? state.generator.addHeight + depthSize : depthSize / 2; for (const axis of ["x", "y", "z"]) { min[axis] = roundToGrid(min[axis], state.grid); max[axis] = roundToGrid(max[axis], state.grid); } if (["x", "y", "z"].some(axis => min[axis] === max[axis])) return setStatus("Brush creation collapsed on the current grid", true); const created = box(min, max); add([created], "Block created"); });
document.querySelector(".tool-rail")?.remove();
document.querySelector(".brush-panel")?.remove();
const toolRail = document.createElement("aside");
toolRail.className = "tool-rail";
const railSizeObserver = new ResizeObserver(entries => { const width = entries[0].contentRect.width; toolRail.classList.toggle("compact", width < 56); });
toolRail.innerHTML = `<button type="button" data-tool-mode="selection" title="Selection tool"><svg viewBox="0 0 24 24"><path d="M5 3l12 10-6 1-3 7-3-18z"/></svg><span>Select</span></button><button type="button" data-tool-mode="brush" title="Brush tool"><svg viewBox="0 0 24 24"><path d="M4 18h16M6 14h12V5H6z"/></svg><span>Brush</span></button><button type="button" data-tool-mode="vertex" title="Vertex editing"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19M5 5h14v14H5z"/></svg><span>Vertex</span></button>`;
document.querySelector("main").prepend(toolRail);
railSizeObserver.observe(toolRail);
let selectionShape = "box";
toolRail.querySelectorAll("[data-tool-mode]").forEach(button => button.onclick = () => { const mode = button.dataset.toolMode; if (mode === "selection") { state.mode = "selection"; state.tool = "box"; railDock.classList.remove("available"); setRailExpanded(false); setStatus("Square selection active"); } else if (mode === "brush") { state.mode = "brush"; state.tool = "brush"; setRailExpanded(true); showBrushDock(); setStatus("Brush tool active"); } else { state.mode = "vertex"; state.tool = "box"; railDock.classList.remove("available"); setRailExpanded(false); setStatus("Vertex editing active"); } toolRail.querySelectorAll("[data-tool-mode]").forEach(item => item.classList.toggle("active", item === button)); });
toolRail.querySelector('[data-tool-mode="selection"]').classList.add("active");
const RELOAD_STATE_KEY = "hammer-prefab-tool-hmr-state";
let allFiles = [];
let visibleFiles = [];
let browserSelected = null;

state.generator = { radius: 256, width: 64, height: 128, segments: 32, startAngle: 0, arc: 180, addHeight: 0 };
state.grid = 16;
const brushPanel = document.createElement("aside");
brushPanel.className = "brush-panel";
brushPanel.hidden = false;
brushPanel.innerHTML = `<header><strong>BRUSH TOOLS</strong></header><div class="brush-shapes"><button data-shape="block">Block</button><button data-shape="ring">Ring</button><button data-shape="arch">Arch</button></div><label>Width <input type="range" data-setting="width" min="1" max="1024" value="64"><output data-output="width">64</output></label><label>Depth <input type="range" data-setting="depth" min="1" max="1024" value="64"><output data-output="depth">64</output></label><label>Height <input type="range" data-setting="height" min="1" max="1024" value="128"><output data-output="height">128</output></label><label>Radius <input type="range" data-setting="radius" min="8" max="2048" value="256"><output data-output="radius">256</output></label><label>Sides <input type="range" data-setting="segments" min="3" max="128" value="32"><output data-output="segments">32</output></label><label>Arc <input type="range" data-setting="arc" min="1" max="360" value="180"><output data-output="arc">180</output></label><label class="check-row"><input type="checkbox" data-setting="powerOfTwo"> Power of 2</label><label class="check-row"><input type="checkbox" data-setting="sloped"> Enable slope settings</label><label class="advanced-setting">Elevation <input type="range" data-setting="addHeight" min="-512" max="512" value="0"><output data-output="addHeight">0</output></label><button class="generate-brush" data-generate>Generate Brush</button>`;
toolRail.append(brushPanel);
const railButtons = [...toolRail.querySelectorAll("[data-tool-mode]")];
const railTools = document.createElement("div");
railTools.className = "rail-tools";
railButtons.forEach(button => railTools.append(button));
const selectionScopeToggle = $("selection-scope-toggle");
function updateSelectionScopeToggle() { selectionScopeToggle.dataset.scope = state.selectionScope; selectionScopeToggle.title = `${state.selectionScope === "group" ? "Group" : "Object"} selection`; }
selectionScopeToggle.onclick = () => { state.selectionScope = state.selectionScope === "group" ? "object" : "group"; state.mode = "selection"; state.tool = "box"; railButtons.forEach(item => item.classList.toggle("active", item.dataset.toolMode === "selection")); updateSelectionScopeToggle(); setStatus(`${state.selectionScope === "group" ? "Group" : "Object"} selection active`); };
updateSelectionScopeToggle();
const textureAxesToggle = $("texture-axes-toggle");
function updateTextureAxesToggle() { textureAxesToggle.classList.toggle("active", state.showTextureAxes); textureAxesToggle.setAttribute("aria-pressed", String(state.showTextureAxes)); textureAxesToggle.title = `${state.showTextureAxes ? "Hide" : "Show"} texture alignment`; }
textureAxesToggle.onclick = () => { state.showTextureAxes = !state.showTextureAxes; updateTextureAxesToggle(); redraw(); setStatus(`Texture alignment ${state.showTextureAxes ? "shown" : "hidden"}`); };
updateTextureAxesToggle();
const railDock = document.createElement("div");
railDock.className = "rail-dock";
const dockDivider = document.createElement("div");
dockDivider.className = "dock-divider";
dockDivider.title = "Drag to resize generator pane";
railDock.append(dockDivider, brushPanel);
const railWidthGrip = document.createElement("div");
railWidthGrip.className = "rail-width-grip";
toolRail.append(railTools, railDock, railWidthGrip);
let railWidth = 132;
const editorMain = document.querySelector("main");
const railExpandedMinimum = 220;
const railToolsMinimumHeight = 108;
function setRailExpanded(expanded) { const width = expanded ? Math.max(railExpandedMinimum, railWidth) : 42; toolRail.classList.toggle("tool-active", expanded); editorMain.classList.toggle("rail-open", expanded); toolRail.style.setProperty("--rail-width", `${width}px`); editorMain.style.setProperty("--rail-overlay-width", `${width}px`); }
let dockHideTimer = null;
let dockFadeTimer = null;
function showBrushDock() { if (state.mode === "brush") { clearTimeout(dockFadeTimer); clearTimeout(dockHideTimer); const availableHeight = toolRail.clientHeight - railToolsMinimumHeight; if (availableHeight < dockMinimumHeight) { railDock.classList.remove("available"); return; } railDock.classList.remove("closing", "collapsed"); railDock.classList.add("available"); toolRail.style.setProperty("--dock-height", `${Math.min(dockHeight, availableHeight)}px`); } }
function hideBrushDock() { if (state.mode === "brush" && railDock.classList.contains("available")) { clearTimeout(dockFadeTimer); clearTimeout(dockHideTimer); dockFadeTimer = setTimeout(() => { if (!toolRail.matches(":hover")) railDock.classList.add("closing"); }, 180); dockHideTimer = setTimeout(() => { if (!toolRail.matches(":hover")) railDock.classList.remove("available", "closing"); }, 530); } }
toolRail.addEventListener("mouseenter", () => { showBrushDock(); setRailExpanded(true); });
toolRail.addEventListener("mouseleave", () => { hideBrushDock(); setRailExpanded(false); });
let resizingRail = null;
const dockMinimumHeight = 140;
let dockHeight = 560;
dockDivider.addEventListener("pointerdown", event => { event.preventDefault(); dockDivider.setPointerCapture(event.pointerId); resizingRail = { type: "dock", start: event.clientY, height: railDock.getBoundingClientRect().height }; });
railWidthGrip.addEventListener("pointerdown", event => { event.preventDefault(); railWidthGrip.setPointerCapture(event.pointerId); resizingRail = { type: "rail", start: event.clientX, width: toolRail.getBoundingClientRect().width }; });
window.addEventListener("pointermove", event => { if (!resizingRail) return; if (resizingRail.type === "dock") { const maxHeight = Math.max(0, toolRail.clientHeight - railToolsMinimumHeight); const requested = resizingRail.height - (event.clientY - resizingRail.start); const height = Math.max(0, Math.min(maxHeight, requested)); if (height < dockMinimumHeight) { railDock.classList.add("collapsed"); } else { dockHeight = height; railDock.classList.remove("collapsed"); toolRail.style.setProperty("--dock-height", `${dockHeight}px`); } } else { railWidth = Math.max(railExpandedMinimum, Math.min(320, resizingRail.width + event.clientX - resizingRail.start)); toolRail.style.setProperty("--rail-width", `${railWidth}px`); editorMain.style.setProperty("--rail-overlay-width", `${railWidth}px`); } });
window.addEventListener("pointerup", () => { resizingRail = null; });
let brushShape = "block";
let brushDepth = 64;
let powerOfTwo = false;
brushPanel.querySelectorAll("[data-shape]").forEach(button => button.onclick = () => { brushShape = button.dataset.shape; brushPanel.querySelectorAll("[data-shape]").forEach(item => item.classList.toggle("active", item === button)); });
brushPanel.querySelector("[data-shape='block']").classList.add("active");
brushPanel.querySelectorAll("[data-setting]").forEach(input => input.oninput = () => { let value = input.type === "checkbox" ? input.checked : Number(input.value); if (input.dataset.setting === "powerOfTwo") powerOfTwo = value; if (powerOfTwo && ["width", "depth", "height", "radius"].includes(input.dataset.setting)) value = 2 ** Math.round(Math.log2(Math.max(1, value))); if (input.dataset.setting === "depth") brushDepth = value; if (input.dataset.setting in state.generator) state.generator[input.dataset.setting] = value; input.value = value; const output = brushPanel.querySelector(`[data-output="${input.dataset.setting}"]`); if (output) output.value = value; brushPanel.querySelector(".advanced-setting").classList.toggle("enabled", Boolean(brushPanel.querySelector('[data-setting="sloped"]').checked)); });
brushPanel.querySelector("[data-generate]").onclick = () => { if (brushShape === "block") add([box({ x: -state.generator.width / 2, y: -brushDepth / 2, z: 0 }, { x: state.generator.width / 2, y: brushDepth / 2, z: state.generator.height })], "Block created"); else { const settings = options(); add(generateRing({ ...settings, endAngle: settings.startAngle + (brushShape === "ring" ? 360 : settings.arc) }), brushShape === "ring" ? "Ring created" : "Arch created"); } };
const snapshot = () => ({ brushes: clone(state.brushes), grid: state.grid, selection: [...state.selection], brushSelection: [...state.brushSelection], selectionScope: state.selectionScope, showTextureAxes: state.showTextureAxes, textureLock: state.textureLock });
function redraw() { view.kind = activeView; view.draw(); $("view-selector").textContent = viewLabels[activeView]; $("stats").textContent = `${state.brushes.length} brush${state.brushes.length === 1 ? "" : "es"} · ${state.selection.size} selected vertices`; }
function changed() { history.push(snapshot()); redraw(); }
function setStatus(text, error = false) { status.textContent = text; status.style.color = error ? "#ff8290" : ""; }
function restore(data) { if (!data) return; state.brushes = data.brushes || []; state.grid = +data.grid || 16; state.selection = new Set(data.selection || []); state.brushSelection = new Set(data.brushSelection || []); state.selectionScope = data.selectionScope || "object"; state.showTextureAxes = Boolean(data.showTextureAxes); state.textureLock = data.textureLock || "world"; activeView = data.view || activeView; state.view = activeView; view.kind = activeView; updateSelectionScopeToggle(); updateTextureAxesToggle(); if (data.camera) { view.scale = data.camera.scale || 1; view.offset = data.camera.offset || { x: 0, y: 0 }; } $("grid").value = state.grid; redraw(); }
function saveHmrState() { try { sessionStorage.setItem(RELOAD_STATE_KEY, JSON.stringify({ ...snapshot(), view: activeView, camera: { scale: view.scale, offset: view.offset }, history: history.items, historyIndex: history.index })); } catch (error) { console.warn("[Hammer Prefab Tool] HMR state save failed", error); } }
function restoreHmrState() { try { const raw = sessionStorage.getItem(RELOAD_STATE_KEY); if (!raw) return false; sessionStorage.removeItem(RELOAD_STATE_KEY); const data = JSON.parse(raw); restore(data); if (Array.isArray(data.history)) { history.items = data.history; history.index = data.historyIndex ?? data.history.length - 1; } return true; } catch (error) { sessionStorage.removeItem(RELOAD_STATE_KEY); console.warn("[Hammer Prefab Tool] HMR state restore failed", error); return false; } }
function options() { const settings = state.generator; return { radius: settings.radius, width: settings.width, height: settings.height, segments: settings.segments, startAngle: settings.startAngle, endAngle: settings.startAngle + settings.arc, addHeight: settings.addHeight, grid: state.grid }; }
function add(brushes, label) { const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; brushes.forEach(brush => { brush.groupId = groupId; }); state.brushes.push(...brushes); changed(); setStatus(`${label}: ${brushes.length} snapped brush segments`); }
function setGrid(delta) { const index = Math.max(0, Math.min(GRID_VALUES.length - 1, GRID_VALUES.indexOf(state.grid) + delta)); state.grid = GRID_VALUES[index]; $("grid").value = state.grid; document.querySelector(".menu-note").textContent = `Current grid: ${state.grid}. Use [ and ] to change.`; redraw(); }
function clearVMF() { if (!state.brushes.length) return; state.brushes = []; changed(); setStatus("VMF cleared"); }
function validate() { const issues = validateAll(state.brushes); setStatus(issues.length ? `Validation: ${issues[0]}` : `Validated ${state.brushes.length} brush solids${state.brushes.length ? "" : " (empty)"}`, !!issues.length); return issues; }
async function exportVMF() { const path = prompt("VMF filename:", "prefab.vmf"); if (!path) return; try { const issues = validate(); if (issues.length) return; const result = await api.exportVMF(path.endsWith(".vmf") ? path : `${path}.vmf`, writeVMF(state.brushes)); setStatus(`Exported ${result.path}`); } catch (error) { setStatus(error.message, true); } }
const escapeHtml = value => String(value).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
function wildcard(expression) { return new RegExp(`^${expression.trim().split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i"); }
function filterFiles() { const query = search.value.trim(); const matcher = query ? wildcard(query) : null; visibleFiles = allFiles.filter(file => !matcher || matcher.test(file.name)); browserSelected = null; renderBrowser(); }
function renderBrowser() { const list = $("browser-list"); if (!visibleFiles.length) { list.innerHTML = `<p class="browser-empty">No VMF files match this search.</p>`; return; } list.innerHTML = visibleFiles.map((file, index) => `<button type="button" data-file="${index}" class="${browserSelected?.name === file.name ? "active" : ""}"><span>${escapeHtml(file.name)}</span><small>${new Date(file.modified).toLocaleString()} · ${file.size} B</small></button>`).join(""); list.querySelectorAll("[data-file]").forEach(button => { button.onclick = () => { browserSelected = visibleFiles[+button.dataset.file]; renderBrowser(); }; button.ondblclick = loadSelected; }); }
async function openBrowser() { browserSelected = null; search.value = ""; $("browser-status").textContent = "Loading..."; browser.showModal(); try { allFiles = (await api.files("export")).files.filter(file => file.name.toLowerCase().endsWith(".vmf")); visibleFiles = allFiles; renderBrowser(); $("browser-status").textContent = `${allFiles.length} VMF file${allFiles.length === 1 ? "" : "s"} · double-click to open`; search.focus(); } catch (error) { allFiles = []; visibleFiles = []; renderBrowser(); $("browser-status").textContent = error.message; } }
async function loadSelected() { if (!browserSelected) return; try { const result = await api.openVMF(browserSelected.name, "export"); state.brushes = parseVMF(result.vmf); state.selection = new Set(); state.brushSelection = new Set(); history.push(snapshot()); redraw(); view.focus(); browser.close(); const groupCount = new Set(state.brushes.map(brush => brush.groupId).filter(Boolean)).size, gridReport = countOffGridCoordinates(state.brushes, state.grid); setStatus(`Opened ${result.path}: ${state.brushes.length} brushes · ${groupCount} groups · ${gridReport.offGrid}/${gridReport.total} coordinates off grid ${state.grid}`, gridReport.offGrid > 0); } catch (error) { $("browser-status").textContent = error.message; } }
function run(command) { if (command === "select-none") { state.selection.clear(); state.brushSelection.clear(); changed(); setStatus("Selection cleared"); } if (command === "delete") { const ids = new Set(state.brushSelection); state.selection.forEach(vertexId => ids.add(vertexId.split(":v:")[0])); if (!ids.size) return setStatus("Select brushes or vertices first", true); state.brushes = state.brushes.filter(brush => !ids.has(brush.id)); state.selection.clear(); state.brushSelection.clear(); changed(); setStatus(`Deleted ${ids.size} brush${ids.size === 1 ? "" : "es"}`); } if (command === "block") add([box()], "Block created"); if (command === "ring") { const settings = options(); add(generateRing({ ...settings, endAngle: settings.startAngle + 360 }), "Ring created"); } if (command === "arch") add(generateRing(options()), "Arch created"); if (command === "undo") restore(history.undo()); if (command === "redo") restore(history.redo()); if (command === "center") { view.focus(); setStatus("Preview fitted to geometry"); } if (command === "world") { view.centerWorld(); setStatus("World origin centered"); } if (command === "validate") validate(); if (command === "clear") clearVMF(); if (command === "grid-down") setGrid(-1); if (command === "grid-up") setGrid(1); if (command === "snap-grid") { const moved = snapAllVertices(state.brushes, state.grid); if (moved) changed(); else redraw(); setStatus(moved ? `Snapped ${moved} vertex coordinates to grid ${state.grid}` : `All vertices are already on grid ${state.grid}`); } if (command === "align-center" || command === "align-outer") { const outer = command === "align-outer", count = outer ? alignAllFacesToOuter(state.brushes) : alignAllFacesToCenter(state.brushes); if (count) changed(); else redraw(); setStatus(count ? `${outer ? "Outer" : "Center"}-aligned ${count} face${count === 1 ? "" : "s"}` : `No faces could be ${outer ? "outer" : "center"}-aligned`, !count); } if (command === "select-inner") { state.selection = new Set(ringVertexIds(state.brushes, "inner")); changed(); setStatus(`${state.selection.size} inner-ring vertices selected`); } if (command === "select-outer") { state.selection = new Set(ringVertexIds(state.brushes, "outer")); changed(); setStatus(`${state.selection.size} outer-ring vertices selected`); } if (command === "scale") { const bounds = selectionBounds(state); if (!bounds) return setStatus("Select vertices first", true); const pivot = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 }; const factor = Number(prompt("Scale factor:", "1.1")); if (!Number.isFinite(factor)) return; const before = clone(state.brushes); scaleVertices(state, pivot, { x: factor, y: factor, z: factor }); const issues = validateAll(state.brushes); if (issues.length) { state.brushes = before; return setStatus(`Scale rejected: ${issues[0]}`, true); } changed(); setStatus(`Scaled ${state.selection.size} vertices around selection center`); } if (command === "inner-radius" || command === "outer-radius") { const radius = Number(prompt("Radius:", command === "inner-radius" ? "224" : "288")); if (!Number.isFinite(radius) || radius <= 0) return; const before = clone(state.brushes); const count = setRingRadius(state, radius, command === "inner-radius" ? "inner" : "outer"); const issues = validateAll(state.brushes); if (issues.length) { state.brushes = before; return setStatus(`Radius change rejected: ${issues[0]}`, true); } if (count) changed(); setStatus(`${command === "inner-radius" ? "Inner" : "Outer"} radius set for ${count} vertices`); } if (command === "export") exportVMF(); }

$("grid").onchange = event => { state.grid = +event.target.value; document.querySelector(".menu-note").textContent = `Current grid: ${state.grid}. Use [ and ] to change.`; redraw(); };
$("view-selector").onclick = () => { activeView = viewNames[(viewNames.indexOf(activeView) + 1) % viewNames.length]; state.view = activeView; redraw(); setStatus(`View: ${viewLabels[activeView]}`); };
$("key-toggle").onclick = () => { const key = $("editor-key"); const open = !key.classList.contains("open"); key.classList.toggle("open", open); key.setAttribute("aria-hidden", String(!open)); $("key-toggle").setAttribute("aria-expanded", String(open)); $("key-toggle").title = open ? "Hide controls and key" : "Show controls and key"; };
$("open-browser").onclick = openBrowser;
search.oninput = filterFiles;
search.onkeydown = event => { if (event.key === "Enter" && browserSelected) { event.preventDefault(); loadSelected(); } };
document.querySelectorAll("[data-command]").forEach(button => button.onclick = () => run(button.dataset.command));
const contextMenu = $("context-menu");
$("editor").addEventListener("contextmenu", event => { event.preventDefault(); contextMenu.style.left = `${event.clientX}px`; contextMenu.style.top = `${event.clientY}px`; contextMenu.classList.add("open"); });
document.addEventListener("pointerdown", event => { if (!contextMenu.contains(event.target)) contextMenu.classList.remove("open"); });
contextMenu.querySelectorAll("[data-command]").forEach(button => button.onclick = () => { run(button.dataset.command); contextMenu.classList.remove("open"); });
const menus = [...document.querySelectorAll(".drop-menu")];
function closeMenus() { menus.forEach(item => item.classList.remove("open")); document.querySelectorAll("[data-menu]").forEach(item => item.classList.remove("active")); }
document.querySelectorAll("[data-menu]").forEach(button => button.addEventListener("mouseenter", () => { if (!menus.some(menu => menu.classList.contains("open"))) return; const menu = $(button.dataset.menu); menus.forEach(item => item.classList.remove("open")); document.querySelectorAll("[data-menu]").forEach(item => item.classList.remove("active")); menu.classList.add("open"); button.classList.add("active"); menu.style.left = `${button.getBoundingClientRect().left}px`; }));
document.querySelectorAll("[data-menu]").forEach(button => button.onclick = event => { event.stopPropagation(); const menu = $(button.dataset.menu); const opening = !menu.classList.contains("open"); menus.forEach(item => item.classList.remove("open")); document.querySelectorAll("[data-menu]").forEach(item => item.classList.remove("active")); if (opening) { menu.classList.add("open"); button.classList.add("active"); menu.style.left = `${button.getBoundingClientRect().left}px`; } });
document.addEventListener("pointermove", event => { if (menus.some(menu => menu.classList.contains("open")) && !event.target.closest(".menu-bar") && !event.target.closest(".drop-menu")) closeMenus(); });
document.addEventListener("pointerdown", event => { if (!event.target.closest(".menu-bar") && !event.target.closest(".drop-menu")) { menus.forEach(item => item.classList.remove("open")); document.querySelectorAll("[data-menu]").forEach(item => item.classList.remove("active")); } });
window.addEventListener("keydown", event => { if (browser.open && event.key === "Escape") { browser.close(); return; } if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return; const key = event.key.toLowerCase(); if (event.key === "Delete") { event.preventDefault(); run("delete"); return; } if (event.key === "Enter") { setStatus(`${state.selection.size} vertices selected`); return; } if ((event.ctrlKey || event.metaKey) && key === "o") { event.preventDefault(); openBrowser(); return; } if ((event.ctrlKey || event.metaKey) && key === "s") { event.preventDefault(); run("export"); return; } if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); run(event.shiftKey ? "redo" : "undo"); return; } if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); run("redo"); return; } if (key === "b") run("block"); if (key === "r") run("ring"); if (key === "a") run("arch"); if (key === "f") run("center"); if (event.key === "Home") run("world"); if (key === "[") setGrid(-1); if (key === "]") setGrid(1); if (event.key.startsWith("Arrow")) { const axis = event.key === "ArrowLeft" || event.key === "ArrowRight" ? "x" : "y"; nudge(state, axis, (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1) * state.grid); changed(); } });
if (import.meta.hot) {
  hmrIndicator.dataset.state = "connected";
  hmrIndicator.title = "Development HMR connected";
  import.meta.hot.on("vite:beforeUpdate", () => { hmrIndicator.dataset.state = "reloading"; hmrIndicator.title = "HMR update pending"; });
  import.meta.hot.on("vite:afterUpdate", () => { hmrIndicator.dataset.state = "connected"; hmrIndicator.title = "Development HMR connected"; });
  import.meta.hot.on("vite:error", () => { hmrIndicator.dataset.state = "offline"; hmrIndicator.title = "HMR error"; });
  import.meta.hot.on("vite:beforeFullReload", saveHmrState);
}
async function start() { try { await api.config(); setStatus(""); } catch (error) { setStatus(error.message, true); } if (!state.__initialized && !restoreHmrState()) { state.brushes = []; history.push(snapshot()); } state.__initialized = true; redraw(); }
start();
