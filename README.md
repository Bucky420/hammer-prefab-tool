# Hammer Prefab Tool

Hammer Prefab Tool is a browser editor for refining Source Engine brush prefabs before using them in Hammer or Hammer++.

Open ordinary VMF brush geometry, adjust it with Hammer-style grids and selection controls, validate the result, and export either a standard VMF or a Hammer prefab VMF.

![Hammer Prefab Tool showing generated curved geometry and its texture axes](docs/hammer-prefab-tool-preview-v2.jpg)

> [!IMPORTANT]
> This is an early, experimental project. It complements Hammer; it is not a complete map editor or a replacement for compiling and testing in Hammer.

## Use Online

The GitHub Pages deployment target is `https://bucky420.github.io/hammer-prefab-tool/`. Pushes to `main` run the Pages workflow, test the editor, build it with the repository subdirectory base, and deploy `dist/`.

The hosted application runs entirely in the browser. VMF and project files are read locally and are not uploaded to an application server. Opening, editing, autosaving, and exporting do not send their contents to this project or to a third-party storage service.

Basic hosted workflow:

1. Choose **File > Open VMF** or **Open Project**, or drop one supported file onto the editor.
2. Edit the brush geometry in the top, front, or side orthographic view.
3. Save an editable project as `.hptproject.json`, or export a standard or Hammer prefab `.vmf`.
4. Open the exported VMF directly in Hammer or Hammer++ and compile/test it there.

## Features

- Import and export ordinary convex world and brush-entity VMF solids
- Preserve Hammer groups, entities, entity I/O, texture axes, side data, and unrecognized VMF chunks during normal round trips
- Generate Block, Arch, Cylinder, Sphere, and Torus brush geometry
- Edit in Hammer-compatible top, front, and side orthographic views
- Select and move individual brushes, Hammer groups, faces, or vertices
- Use Hammer-style grids, snapping, keyboard nudging, object transforms, face extrusion, and selection modifiers
- Select semantic inner or outer generated vertices and change their radii
- Inspect and update texture alignment while preserving loaded axes unless explicitly changed
- Validate generated and transformed solids before export
- Undo and redo document and selection changes

## Opening And Saving Files

The default hosted and development mode uses browser storage and browser file APIs:

- **Open VMF** accepts `.vmf`; **Open Project** accepts `.hptproject.json` and legacy `.json` projects.
- Drag and drop accepts exactly one VMF or project file anywhere on the page.
- Browsers with the File System Access API can retain a directly opened file handle for **Save Current File** and **Save Current File As**.
- Other browsers fall back to normal file inputs for opening and downloads for saving or exporting.
- Standard VMF export produces an ordinary VMF that can be opened directly in Hammer. Editor groups remain Hammer groups instead of being converted to entities.

The portable project extension is `.hptproject.json`. Current files use this top-level identity:

```json
{
  "format": "hammer-prefab-tool-project",
  "version": 2
}
```

The schema stores brushes, entities, Hammer groups, preserved VMF document data, semantic ring metadata, grid settings, extrusion settings, and project settings. It deliberately excludes transient selections, hidden-object state, camera state, and editing mode.

The loader migrates version 1 project files, legacy `{ "state": ... }` wrappers, and older raw JSON state into the current version. It also migrates the old `forward-snap` extrusion mode to `straight`. Files newer than the supported schema version are rejected rather than guessed at.

## Autosave And Recovery

Browser-mode autosaves are local IndexedDB snapshots. Dirty documents are saved shortly after a document change and on the autosave interval; the newest 20 snapshots are retained.

- **File > Restore Autosave** restores the newest available snapshot as an unsaved document.
- **File > Discard Autosave** removes the newest snapshot after confirmation.
- The title and header show whether the current project differs from its saved checkpoint.
- Opening another file, clearing the document, or replacing dirty work asks for confirmation.
- Closing or reloading a dirty document triggers the browser's unsaved-changes warning.

Autosave is recovery, not a replacement for saving a `.hptproject.json` file.

## VMF Export Modes

### Standard VMF

**Export VMF** writes normal VMF world geometry. Imported entities and brush entities remain entities, and editor groups remain directly usable Hammer groups. No Hammer Prefab Tool marker is added.

### Hammer Prefab VMF

**Export Hammer Prefab VMF** has two modes:

- **func_detail per group** creates one `func_detail` for each generated ring/assembly or non-empty group. Ungrouped world brushes stay in `worldspawn`, and existing entities are preserved.
- **Hammer groups** keeps the geometry as Hammer groups without converting it to `func_detail`.

Prefab exports include Source's `versioninfo.prefab = 1`, `formatversion = 100`, and the world key `hammer_prefab_tool_version = 1` so the file is identifiable as a prefab export.

Optional **Floor**, **Ceiling**, or **Both** structural backing adds rectangular `tools/toolsnodraw` world brushes across each converted assembly or group's bounds. In **Hammer groups** mode, one rectangle spans the complete export. This makes a convenient structural slab, but the rectangle also fills the complete center footprint of curved or hollow geometry. Leave backing disabled when that filled center is not wanted.

## Semantic Textures

Generated curved assemblies carry semantic face roles and default visible materials such as `prefab/ring_top`, `prefab/ring_bottom`, `prefab/ring_inner`, and `prefab/ring_outer`. Internal interface faces use `tools/toolsnodraw`.

To replace textures by role, select any object, face, or vertex in an assembly, choose the semantic role and material under **Tools**, then apply it to the selected ring. The replacement follows the selected object's complete assembly/group and changes only matching semantic faces. Existing `tools/toolsnodraw` faces are intentionally never replaced.

## Updates And Offline Use

Static hosted builds include a version manifest and service worker. A fully downloaded newer build activates without forcing the current editor session to reload.

- **Update available** appears when the running page is older than the active build.
- Clicking it first writes an IndexedDB recovery snapshot and session recovery state, then reloads and restores the editor state in the new build. The update is blocked if neither recovery method succeeds.
- Pressing `F5` loads the newest fully staged active build; dirty-work warnings still apply.
- After one successful hosted load, navigation and assets can fall back to retained cached builds while offline. Update checks fail harmlessly and retry later.

The build-free local server does not register this hosted-build service worker.

## Local Server Mode

Node.js 20.19 or newer is required only for building, development, tests, or the optional local server. Install dependencies, start the build-free server, and explicitly select server storage:

```bat
npm install
npm run start:local
```

Open [http://localhost:8787/?storage=server](http://localhost:8787/?storage=server). This mode serves `public/` directly without a frontend build and uses the loopback API to browse and write the directories configured in `config.json`. Configured project, import, export, and backup roots are path-restricted. Browser IndexedDB recovery remains available.

Opening `http://localhost:8787/` without `?storage=server` uses the same browser-file workflow as the hosted application.

## Build And Development

Install dependencies once:

```bat
git clone https://github.com/Bucky420/hammer-prefab-tool.git
cd hammer-prefab-tool
npm install
```

Create a static hosted build:

```bat
npm run build
```

The build is written to `dist/` and contains no runtime Node or `/api` dependency. Its default Vite base is relative (`./`), so the same output can be served from a domain root or a subdirectory such as GitHub Pages. A deployment that requires an explicit base can set `HAMMER_BASE_PATH`, for example `/hammer-prefab-tool/`, before running the build. Publish the contents of `dist/`, not the source `public/` directory.

Preview the static build locally:

```bat
npm run preview
```

Run Vite HMR with the supervised backend:

```bat
npm run dev
```

Development serves the frontend at `http://127.0.0.1:8787` and proxies `/api` to the backend on port `8788`. Use `?storage=server` when testing server-backed file storage; otherwise development uses browser files and IndexedDB. Do not run development and local-server launchers at the same time.

## Tests

Run the complete type, contract, geometry, persistence, VMF, static-build, update, and browser-smoke suite:

```bat
npm test
```

Focused commands are also available:

```bat
npm run typecheck
npm run test:persistence
npm run test:vmf
npm run test:static-build
npm run test:update-manager
npm run test:browser
```

`npm run check` is the same complete suite used by `npm test`. The browser smoke test reports a skip when no supported headless browser is installed.

## Selection Controls

- Drag empty space to create a selection box.
- Hold `Shift` to add to the selection.
- Hold `Alt` to remove from the selection.
- Hold `Ctrl` to toggle selection.
- Press `Delete` to remove selected geometry.
- Press `Ctrl+Z` or `Ctrl+Y` to undo or redo.
- Use the Object/Group toolbar toggle to switch selection scope.

## Limitations

The editor is designed around ordinary closed, convex Source brushes. It is not a complete VMF editor.

- Entities, entity I/O, world metadata, duplicate keys, editor metadata, and unknown chunks are preserved through the document model, but most are opaque and cannot be edited in the UI.
- Displacement `dispinfo` data is preserved opaquely under its original side, but displacement editing is unsupported. Transforming the parent brush does not transform that opaque displacement payload and may produce an invalid result.
- Face and vertex tooling does not cover every Hammer operation, and advanced map systems such as lighting, visgroups, compilation, carving, roads, paths, and general displacement workflows remain Hammer responsibilities.
- The validator checks important brush structure, finiteness, convexity, closure, winding, bounds, and face conditions, but it does not yet enforce every Source brush requirement or validate all opaque VMF data.

Always inspect exported geometry, validate it in Hammer, and compile/test it before using it in a production map.

## Contributing

Bug reports, test results, and focused pull requests are welcome. Keep exported geometry as valid convex Source brushes, and do not present planned controls as completed features.

## License

Licensed under the [Zero-Clause BSD License](LICENSE). You may use, copy, modify, distribute, or sell the software without requiring attribution.

Third-party dependencies remain subject to their own licenses and notices.
