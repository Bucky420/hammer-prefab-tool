const TOOL_MARKUP = `<button type="button" data-tool-mode="selection" title="Object selection tool"><svg viewBox="0 0 24 24"><path d="M5 3l12 10-6 1-3 7-3-18z"/></svg><span>Object</span></button><button type="button" data-tool-mode="brush" title="Brush tool"><svg viewBox="0 0 24 24"><path d="M4 18h16M6 14h12V5H6z"/></svg><span>Brush</span></button><button type="button" data-tool-mode="path" title="Path generator tool"><svg viewBox="0 0 24 24"><path d="M4 18l5-10 6 8 5-11"/><circle cx="4" cy="18" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="16" r="1.5"/><circle cx="20" cy="5" r="1.5"/></svg><span>Path</span></button><button type="button" data-tool-mode="face" title="Face selection and extrusion"><svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4zM4 7v9l8 5v-10M20 7v9l-8 5"/></svg><span>Face</span></button><button type="button" data-tool-mode="vertex" title="Vertex editing"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19M5 5h14v14H5z"/></svg><span>Vertex</span></button>`;

export function createToolRail({ state, panels, onModeChange }) {
  globalThis.__hptToolRailCleanup?.();
  const listeners = new AbortController();
  document.querySelector(".tool-rail")?.remove();
  const rail = document.createElement("aside");
  rail.className = "tool-rail";
  const tools = document.createElement("div");
  tools.className = "rail-tools";
  tools.innerHTML = TOOL_MARKUP;
  const dock = document.createElement("div");
  dock.className = "rail-dock";
  const divider = document.createElement("div");
  divider.className = "dock-divider";
  divider.title = "Drag to resize generator pane";
  const widthGrip = document.createElement("div");
  widthGrip.className = "rail-width-grip";
  dock.append(divider, panels.brush, panels.face, panels.path);
  rail.append(tools, dock, widthGrip);
  const main = document.querySelector("main");
  main.prepend(rail);

  const buttons = [...tools.querySelectorAll("[data-tool-mode]")];
  const expandedMinimum = 220;
  const toolsMinimumHeight = 172;
  const dockMinimumHeight = 140;
  let railWidth = 132;
  let dockHeight = 560;
  let hideTimer = null;
  let fadeTimer = null;
  let resizing = null;

  const setExpanded = (expanded) => {
    const width = expanded ? Math.max(expandedMinimum, railWidth) : 42;
    rail.classList.toggle("tool-active", expanded);
    main.classList.toggle("rail-open", expanded);
    rail.style.setProperty("--rail-width", `${width}px`);
    main.style.setProperty("--rail-overlay-width", `${width}px`);
  };
  const showDock = () => {
    if (!["brush", "face", "path"].includes(state.mode)) return;
    clearTimeout(fadeTimer);
    clearTimeout(hideTimer);
    const availableHeight = rail.clientHeight - toolsMinimumHeight;
    if (availableHeight < dockMinimumHeight) {
      dock.classList.remove("available");
      return;
    }
    for (const [mode, panel] of Object.entries(panels))
      panel.hidden = mode !== state.mode;
    dock.classList.remove("closing", "collapsed");
    dock.classList.add("available");
    rail.style.setProperty(
      "--dock-height",
      `${Math.min(dockHeight, availableHeight)}px`,
    );
  };
  const closeDock = () => dock.classList.remove("available", "closing");
  const syncMode = () => {
    buttons.forEach((button) =>
      button.classList.toggle("active", button.dataset.toolMode === state.mode),
    );
  };

  buttons.forEach((button) => {
    button.onclick = () => onModeChange(button.dataset.toolMode);
  });
  rail.addEventListener("mouseenter", () => {
    setExpanded(true);
    showDock();
  });
  rail.addEventListener("mouseleave", () => {
    if (
      ["brush", "face", "path"].includes(state.mode) &&
      dock.classList.contains("available")
    ) {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      fadeTimer = setTimeout(() => {
        if (!rail.matches(":hover")) dock.classList.add("closing");
      }, 180);
      hideTimer = setTimeout(() => {
        if (!rail.matches(":hover")) closeDock();
      }, 530);
    }
    setExpanded(false);
  });
  const sizeObserver = new ResizeObserver((entries) => {
    rail.classList.toggle("compact", entries[0].contentRect.width < 56);
  });
  sizeObserver.observe(rail);

  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    resizing = {
      type: "dock",
      start: event.clientY,
      height: dock.getBoundingClientRect().height,
    };
  });
  widthGrip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    widthGrip.setPointerCapture(event.pointerId);
    resizing = {
      type: "rail",
      start: event.clientX,
      width: rail.getBoundingClientRect().width,
    };
  });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!resizing) return;
      if (resizing.type === "dock") {
        const maxHeight = Math.max(0, rail.clientHeight - toolsMinimumHeight);
        const requested = resizing.height - (event.clientY - resizing.start);
        const height = Math.max(0, Math.min(maxHeight, requested));
        if (height < dockMinimumHeight) dock.classList.add("collapsed");
        else {
          dockHeight = height;
          dock.classList.remove("collapsed");
          rail.style.setProperty("--dock-height", `${dockHeight}px`);
        }
      } else {
        railWidth = Math.max(
          expandedMinimum,
          Math.min(320, resizing.width + event.clientX - resizing.start),
        );
        rail.style.setProperty("--rail-width", `${railWidth}px`);
        main.style.setProperty("--rail-overlay-width", `${railWidth}px`);
      }
    },
    { signal: listeners.signal },
  );
  window.addEventListener(
    "pointerup",
    () => {
      resizing = null;
    },
    { signal: listeners.signal },
  );

  globalThis.__hptToolRailCleanup = () => {
    listeners.abort();
    sizeObserver.disconnect();
  };

  syncMode();
  return { closeDock, setExpanded, showDock, syncMode };
}
