export function bindFileDrop({ input, onFiles }) {
  globalThis.__hptFileDropCleanup?.();
  const listeners = new AbortController();
  let dragDepth = 0;
  const supportedDrag = (event) => {
    const items = Array.from(event.dataTransfer?.items || []);
    return items.length === 1 && items[0].kind === "file";
  };
  const handleInput = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) onFiles(files);
  };

  input.oninput = handleInput;
  input.onchange = handleInput;
  window.addEventListener(
    "dragenter",
    (event) => {
      event.preventDefault();
      if (!supportedDrag(event)) return;
      dragDepth++;
      document.body.classList.add("file-drag-active");
    },
    { signal: listeners.signal },
  );
  window.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = supportedDrag(event) ? "copy" : "none";
    },
    { signal: listeners.signal },
  );
  window.addEventListener(
    "dragleave",
    (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove("file-drag-active");
    },
    { signal: listeners.signal },
  );
  window.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove("file-drag-active");
      onFiles(event.dataTransfer?.files);
    },
    { signal: listeners.signal },
  );
  globalThis.__hptFileDropCleanup = () => listeners.abort();
}
