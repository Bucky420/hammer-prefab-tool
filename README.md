# Hammer Prefab Tool

A local browser tool for making and editing Source Engine brush prefabs for Hammer and Garry's Mod.

This is an early, experimental project. It is not a Hammer replacement or a finished map editor. Expect unfinished features and bugs.

## Current features

- Generate block, ring, and arch brush geometry
- Edit geometry in top, front, and side orthographic views
- Select and move brushes or vertices
- Hammer-style grid snapping and keyboard nudging
- Select inner and outer ring vertices
- Import and export VMF brush geometry
- Validate generated solids before export
- Save projects and create autosave/backups
- Undo and redo

## Requirements

- Windows 10 or newer
- [Node.js](https://nodejs.org/) 20.19 or newer
- Hammer or Hammer++ to use exported VMF files

## Running it

Clone the repository and install its dependencies:

```bat
git clone https://github.com/Bucky420/hammer-prefab-tool.git
cd hammer-prefab-tool
npm install
```

Start the production server:

```bat
start.bat
```

Then open [http://localhost:8787](http://localhost:8787).

You can also run:

```bat
npm start
```

For development with hot reload:

```bat
dev.bat
```

Do not run `start.bat` and `dev.bat` at the same time.

## Basic workflow

1. Open the tool.
2. Choose **Brush** mode.
3. Select Block, Ring, or Arch.
4. Set the shape options and generate it.
5. Edit the result in the viewport.
6. Export it as a VMF.
7. Open or import the VMF in Hammer.

Hammer is still needed for complete maps, entities, materials, lighting, compiling, and testing.

## Configuration

The tool uses `config.json` for its port and file locations. Change `exportDirectory` if you want VMF files written somewhere else.

Paths are restricted to the configured project, import, export, and backup folders.

## Important limitations

The editor is still being built. Face, edge, path, advanced transform, road, stair, tunnel, bevel, carving, and other planned tools are not finished.

Only use controls that are currently present and working. Exported geometry should still be checked in Hammer before using it in a real map.

## Contributing

Bug reports, test results, and focused pull requests are welcome.

Please avoid treating planned features as complete, and keep exported geometry as valid convex Source brushes.

## License

No license has been added yet. Until one is provided, the repository is all rights reserved by default.
