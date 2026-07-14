# Hammer Prefab Tool

A local browser-based brush geometry editor and prefab generator for **Source Engine Hammer** and **Garry's Mod mapping**.

Hammer Prefab Tool makes technical brush work easier: generate rings and arches, edit vertices in orthographic views, preserve texture alignment, validate Source-compatible convex solids, and export ordinary `.vmf` files that can be opened in Hammer.

> [!IMPORTANT]
> This project is under active development. It is a companion tool for Hammer, not a replacement for Hammer or a general-purpose 3D modeler.

## What it does

- Generates blocks, segmented rings, and arches
- Displays top, front, and side orthographic views
- Supports object and vertex selection
- Moves and nudges geometry using Hammer-style grid snapping
- Selects inner and outer ring vertices using generator metadata
- Scales selected vertices and edits ring radius
- Imports and exports VMF brush geometry
- Preserves imported coordinates until explicitly snapped
- Preserves loaded texture axes unless a texture command changes them
- Rejects invalid geometry before it is committed or exported
- Provides undo and redo snapshots
- Saves projects, autosaves, and creates backups
- Runs completely locally in your browser

## Current status

The current milestone includes the core editor, brush generator, VMF workflow, grid-aware transforms, validation, and a resizable technical UI.

Still in development:

- Face, edge, and path editing modes
- Complete object/brush interaction behavior
- Rotation, advanced scaling, pivots, and axis locks
- Roads, stairs, tunnels, sweeps, bevels, and carving
- Broader VMF preservation and repair tools
- Compile-log and optimization helpers

Controls for unfinished features are intentionally not presented as working features.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) **20.19 or newer**
- Source Engine Hammer or Hammer++ for using exported VMF prefabs
- Garry's Mod if you are building content for GMod

No database, Electron installation, or production build step is required.

## Installation

1. Download or clone this repository:

   ```bat
   git clone https://github.com/Bucky420/hammer-prefab-tool.git
   cd hammer-prefab-tool
   ```

2. Install the development dependencies:

   ```bat
   npm install
   ```

3. Review `config.json` and set the folders for your machine.

4. Start the tool:

   ```bat
   start.bat
   ```

5. Open [http://localhost:8787](http://localhost:8787) if it does not open automatically.

You can also start production mode directly with:

```bat
npm start
```

## Configuration

The application reads `config.json` from the project directory.

```json
{
  "port": 8787,
  "projectDirectory": "projects",
  "importDirectory": "projects",
  "exportDirectory": "D:/SteamLibrary/steamapps/common/GarrysMod/bin/win64/Prefabs",
  "backupDirectory": "backups",
  "autosaveIntervalSeconds": 30
}
```

Change `exportDirectory` to the folder where you want generated VMF files written. Relative paths are resolved from the Hammer Prefab Tool folder; absolute Windows paths are also supported.

The server only permits file access inside the configured project, import, export, and backup roots. Project files must use `.json`; VMF import and export files must use `.vmf`.

## Basic workflow

1. Start Hammer Prefab Tool.
2. Choose **Brush** mode from the left rail.
3. Select Block, Ring, or Arch.
4. Set the dimensions, side count, arc, elevation, and grid options.
5. Generate the geometry.
6. Inspect or edit it in the Top, Front, or Side view.
7. Save the editable project as JSON when needed.
8. Export the result as a VMF.
9. Open or import the exported VMF in Hammer and place the prefab in your map.

Hammer remains responsible for the complete map, entities and I/O, materials, displacements, visgroups, lighting, compilation, and final testing.

## Editor controls

Current selection behavior follows Hammer-style modifier conventions:

- Normal selection replaces the current selection
- **Shift** adds to the selection
- **Alt** removes from the selection
- **Ctrl** toggles selection
- Empty dragging creates a selection box
- Clicking selected vertices moves the selected vertex set
- Clicking selected brushes in object mode moves the brush selection
- Keyboard nudging follows the selected grid size

The active view can be switched between:

- **Top / XY**
- **Front / XZ**
- **Side / YZ**

Generated ring and arch brushes contain semantic vertex roles, allowing reliable inner/outer selection without guessing from coordinates.

## Source brush safety

Every exported solid is validated as an ordinary Source brush. Export is blocked for geometry that is not safe and representable, including:

- Concave or open solids
- Non-planar faces
- Incorrect face winding
- Duplicate planes or vertices
- Zero-area faces or zero-length edges
- Collapsed faces, slivers, or self-intersections
- Non-finite or out-of-bounds coordinates
- Invalid texture axes

Curves are exported as groups of independently valid convex wedges or prisms. The tool does not export arbitrary triangle meshes or concave mesh geometry.

## Grid behavior

Generated geometry and explicit transforms use the selected Hammer grid. Common supported values include:

`0.125`, `0.25`, `0.5`, `1`, `2`, `4`, `8`, `16`, `32`, `64`, `128`, and `256`.

Imported VMF coordinates remain exact until **Tools > Snap All Vertices to Grid** is used. During dragging, snapping is applied to the movement delta from the original position, preventing cumulative rounding drift.

## Development

Start the development environment with:

```bat
dev.bat
```

or:

```bat
npm run dev
```

Development mode uses:

- Vite on `127.0.0.1:8787` for the frontend and hot module replacement
- A supervised Node backend on `127.0.0.1:8788`
- A proxy from `/api/*` to the backend
- Chokidar to restart the backend when server files change

Do not run `start.bat` and `dev.bat` at the same time.

Run the regression tests with:

```bat
node --test tests/milestone.test.mjs
```

Runtime logs are written to:

- `logs/server.log`
- `logs/dev.log`

## Project structure

```text
hammer-prefab-tool/
├── server.js
├── config.json
├── package.json
├── dev.mjs
├── vite.config.mjs
├── start.bat
├── dev.bat
├── public/
│   ├── index.html
│   ├── style.css
│   ├── menu-overrides.css
│   └── js/
│       ├── app.js
│       ├── geometry-model.js
│       ├── grid.js
│       ├── viewport.js
│       ├── selection.js
│       ├── vertex-editor.js
│       ├── ring-generator.js
│       ├── brush-validation.js
│       ├── vmf-parser.js
│       ├── vmf-writer.js
│       └── texture-alignment.js
└── tests/
    └── milestone.test.mjs
```

## Design goals

- Export normal VMF brush geometry that Hammer understands
- Keep geometry valid through every operation
- Match familiar Hammer editing behavior where practical
- Make repetitive curved and technical brush construction faster
- Preserve imported data instead of silently rewriting it
- Keep the production runtime small and local

## Contributing

Bug reports and focused pull requests are welcome. When changing geometry or transforms:

- Keep all exported solids convex, closed, and planar
- Route geometry through the central validator
- Preserve imported coordinates unless the user explicitly snaps them
- Add or update regression coverage
- Keep menu and context-menu actions connected to the same command
- Do not add controls for features that do not actually work

## License

No license has been added yet. Until one is provided, the repository remains all rights reserved by default.
