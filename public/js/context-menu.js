export function bindContextMenu({ editor, run }) {
  globalThis.__hptContextMenuCleanup?.();
  const listeners = new AbortController();
  const menu = document.getElementById("context-menu");
  editor.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      menu.classList.add("open");
    },
    { signal: listeners.signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!menu.contains(event.target)) menu.classList.remove("open");
    },
    { signal: listeners.signal },
  );
  menu.querySelectorAll("[data-command]").forEach((button) => {
    button.onclick = () => {
      run(button.dataset.command);
      menu.classList.remove("open");
    };
  });
  globalThis.__hptContextMenuCleanup = () => listeners.abort();
}
