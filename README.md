# Hammer Prefab Tool

An experimental browser tool for creating and refining Source Engine brush geometry before moving it into Hammer or Hammer++.

## [Open Hammer Prefab Tool →](https://bucky420.github.io/hammer-prefab-tool/)

No installation is required. VMF and project files are processed locally in your browser and are not uploaded.

![Hammer Prefab Tool preview](docs/hammer-prefab-tool-preview-v2.jpg)

> [!IMPORTANT]
> This is an early tool with basic editing features. It complements Hammer; it is not a complete map editor.

## What works now

- Open and export convex VMF brush geometry.
- Select and move brushes, groups, faces, and vertices.
- Hammer-style grid snapping, nudging, undo, and redo.
- Face extrusion, including grouped connected-brush extrusion.
- Basic block, arch, cylinder, sphere, torus, and ring generation.
- Simple texture-axis and semantic ring-material tools.
- Project saving, browser autosaves, and VMF validation.

The grouped extrusion system is currently the most developed part of the editor. Other tools are still basic and may have rough edges.

## Basic workflow

1. Open the [hosted editor](https://bucky420.github.io/hammer-prefab-tool/).
2. Drag in a `.vmf` or `.hptproject.json`, or use the **File** menu.
3. Edit or generate brush geometry.
4. Save an editable project or export a VMF.
5. Open the VMF in Hammer or Hammer++ and compile/test it there.

## Saving and export

- **Save Project** creates an editable `.hptproject.json` file.
- **Export VMF** creates a normal VMF for opening directly in Hammer.
- **Export Hammer Prefab VMF** can keep Hammer groups or create one temporary `func_detail` per group/ring so imported assemblies remain separately selectable.
- Browser autosaves are stored locally for recovery.

Always keep important work in a downloaded project file. Autosave is not a permanent backup.

## Local development

Node.js 20.19 or newer is only required for development, tests, builds, or optional local-server storage.

```bat
git clone https://github.com/Bucky420/hammer-prefab-tool.git
cd hammer-prefab-tool
npm install
npm run dev
```

Useful commands:

```bat
npm run build
npm run preview
npm test
npm run start:local
```

`npm run build` creates the static `dist/` site used for GitHub Pages.

## Limitations

- Only ordinary closed, convex Source brushes are directly supported.
- This is not a full entity, displacement, lighting, VIS, or compile workflow.
- Preserved VMF data may not be editable in the UI.
- Some editing and export paths are still experimental.

Inspect exported geometry in Hammer and compile/test it before using it in a real map.

## License

Licensed under the [Zero-Clause BSD License](LICENSE).