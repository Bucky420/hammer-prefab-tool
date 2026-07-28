# Hammer Prefab Tool

Hammer Prefab Tool is a browser-based editor for creating and refining Source Engine brush geometry before using it in Hammer or Hammer++.

## [Open Hammer Prefab Tool in your browser →](https://bucky420.github.io/hammer-prefab-tool/)

No installation is required for the hosted version. VMF and project files are processed locally in your browser and are not uploaded to a server.

![Hammer Prefab Tool showing generated curved geometry and its texture axes](docs/hammer-prefab-tool-preview-v2.jpg)

> [!IMPORTANT]
> This is an early, experimental project. It complements Hammer; it is not a complete map editor or a replacement for compiling and testing in Hammer.

## Quick Start

1. Open the [hosted editor](https://bucky420.github.io/hammer-prefab-tool/).
2. Choose **File > Open VMF**, **Open Project**, or drag one supported file onto the page.
3. Edit, generate, transform, texture, and validate the brush geometry.
4. Save an editable `.hptproject.json` project or export a Hammer-compatible `.vmf`.
5. Open the exported VMF in Hammer or Hammer++ and compile/test it there.

## Features

- Import and export convex world and brush-entity VMF solids.
- Preserve Hammer groups, entities, entity I/O, texture axes, side data, and unrecognized VMF chunks during normal round trips.
- Generate blocks, arches, cylinders, spheres, and torus/ring geometry.
- Edit in Hammer-compatible top, front, and side orthographic views.
- Select and transform brushes, groups, faces, and vertices.
- Use Hammer-style grids, snapping, keyboard nudging, face extrusion, and undo/redo.
- Select semantic inner or outer generated vertices and adjust their radii.
- Apply semantic materials across an entire generated ring or assembly.
- Validate generated and transformed solids before export.
- Autosave recovery snapshots locally with IndexedDB.
- Work offline after the hosted application has been loaded successfully once.

## Files, Saving, and Privacy

The hosted editor uses browser file APIs and local browser storage:

- **Open VMF** accepts `.vmf` files.
- **Open Project** accepts `.hptproject.json` and legacy `.json` project files.
- Drag and drop accepts one supported file at a time.
- **Save Project** downloads a portable editable project.
- **Export VMF** downloads a standard Hammer-compatible VMF.
- Browsers supporting the File System Access API can also use direct **Save Current File** and **Save Current File As** actions.
- Other browsers automatically use file pickers and downloads instead.

The portable project format uses this identity:

```json
{
  "format": "hammer-prefab-tool-project",
  "version": 2
}
```

Project files preserve brushes, entities, Hammer groups, VMF document data, ring metadata, texture information, grid settings, extrusion settings, and project settings. Runtime-only browser state and file handles are not stored in downloadable projects.

Older supported project formats are migrated during loading. Projects created by an unsupported newer schema version are rejected instead of being guessed at.

### Autosave and recovery

Dirty projects are saved to IndexedDB shortly after changes and on the configured autosave interval. The newest 20 snapshots are retained.

- **File > Restore Autosave** restores the newest snapshot as unsaved work.
- **File > Discard Autosave** removes the newest snapshot after confirmation.
- Opening another file or restoring over dirty work asks for confirmation.
- Reloading or closing a dirty document triggers the browser's unsaved-changes warning.

Autosave is for recovery; keep important work in a downloaded `.hptproject.json` file.

## VMF Export Modes

### Standard VMF

**Export VMF** writes normal VMF geometry. Imported entities remain entities, and editor groups remain Hammer groups. Use this when opening the VMF directly in Hammer or Hammer++.

### Hammer Prefab VMF

**Export Hammer Prefab VMF** supports:

- **func_detail per group** — creates one `func_detail` for each generated ring, assembly, or non-empty group so each remains independently selectable after Hammer prefab insertion.
- **Hammer groups** — keeps geometry as ordinary editor groups without converting it to brush entities.

Ungrouped world brushes remain in `worldspawn`, and existing entities are preserved.

Optional **Floor**, **Ceiling**, or **Both** structural backing creates rectangular `tools/toolsnodraw` world brushes across converted assembly bounds. This can provide a simple structural slab, but it also fills the center footprint of curved or hollow geometry. Leave backing disabled when that filled center is not wanted.

### Semantic textures

Generated curved assemblies can use roles such as:

- `prefab/ring_top`
- `prefab/ring_bottom`
- `prefab/ring_inner`
- `prefab/ring_outer`
- `tools/toolsnodraw`

Select any object, face, or vertex belonging to an assembly, choose a semantic role and material under **Tools**, and apply it to the selected ring. Matching faces across the whole assembly change together while `tools/toolsnodraw` faces remain untouched.

## Updates and Offline Use

Hosted builds include a service worker and version manifest.

- An **Update available** notice appears when a newer complete build is ready.
- Updating first writes recovery state, then reloads into the new build.
- Pressing `F5` loads the newest fully staged build while still respecting dirty-work warnings.
- Cached assets allow the editor to reopen offline after one successful hosted load.

## Local Development

Node.js 20.19 or newer is required only for development, testing, building, or optional local server storage.

```bat
git clone https://github.com/Bucky420/hammer-prefab-tool.git
cd hammer-prefab-tool
npm install
npm run dev
```

Other useful commands:

```bat
npm run build
npm run preview
npm test
```

`npm run build` creates the static `dist/` directory. The production build has no runtime Node dependency and makes no hosted `/api` requests.

### Optional local server storage

```bat
npm run start:local
```

Open [http://localhost:8787/?storage=server](http://localhost:8787/?storage=server) to use the loopback server for browsing and writing configured local project, import, export, and backup directories.

Opening [http://localhost:8787/](http://localhost:8787/) without `?storage=server` uses the same browser-file workflow as the hosted application.

## Tests

Run the complete type, geometry, persistence, VMF, static-build, update, and browser-smoke suite:

```bat
npm test
```

Focused commands:

```bat
npm run typecheck
npm run test:persistence
npm run test:vmf
npm run test:static-build
npm run test:update-manager
npm run test:browser
```

`npm run check` runs the same complete suite as `npm test`. The browser smoke test reports a skip when no supported headless browser is installed.

## Limitations

The editor is designed around ordinary closed, convex Source brushes. It is not a complete VMF editor.

- Most preserved entities, I/O, world metadata, duplicate keys, editor metadata, and unknown chunks cannot yet be edited in the UI.
- Displacement `dispinfo` is preserved opaquely, but displacement editing is unsupported. Transforming a displacement's parent brush may produce invalid displacement data.
- Advanced map systems such as compilation, lighting, visgroups, carving, roads, paths, and general displacement workflows remain Hammer responsibilities.
- The validator checks important brush structure, finiteness, convexity, closure, winding, bounds, and face conditions, but it does not enforce every possible Source requirement.

Always inspect exported geometry in Hammer and compile/test it before using it in a production map.

## Contributing

Bug reports, test results, and focused pull requests are welcome. Keep exported geometry as valid convex Source brushes, and do not present planned controls as completed features.

## License

Licensed under the [Zero-Clause BSD License](LICENSE). You may use, copy, modify, distribute, or sell the software without requiring attribution.

Third-party dependencies remain subject to their own licenses and notices.
