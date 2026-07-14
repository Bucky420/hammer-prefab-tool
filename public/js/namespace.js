export const HP = { state: { brushes: [], selection: new Set(), brushSelection: new Set(), mode: "vertex", tool: "box", view: "top", grid: 16, textureLock: "world", projectName: "untitled.json" }, events: new EventTarget() };
HP.emit = name => HP.events.dispatchEvent(new Event(name));
