const BRAVE_FILE_ACCESS_URL = "brave://flags/#file-system-access-api";

export function createDocumentChrome({ state, isDirty }) {
  const status = document.getElementById("status");
  const filename = document.getElementById("footer-filename");
  const autosave = document.getElementById("autosave-status");

  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.style.color = error ? "#ff8290" : "";
  };
  const syncFilename = () => {
    filename.textContent = state.vmfFilename;
    filename.title = state.vmfFilename;
  };

  return {
    setStatus,
    syncDocument() {
      const dirty = isDirty();
      const title = state.projectName || "Untitled";
      const indicator = document.getElementById("dirty-indicator");
      document.getElementById("document-title").textContent = title;
      document.getElementById("footer-grid").textContent =
        `Grid: ${state.grid}`;
      indicator.textContent = dirty ? "Unsaved" : "Saved";
      indicator.dataset.dirty = String(dirty);
      indicator.title = dirty
        ? "Document has unsaved changes"
        : "Document matches the saved checkpoint";
      document.title = `${dirty ? "* " : ""}${title} - Hammer Prefab Tool`;
      syncFilename();
    },
    syncFilename,
    setAutosave(message, error = false) {
      autosave.textContent = message;
      autosave.style.color = error ? "#ff8290" : "";
    },
    async showFileAccessWarning({ supported, storageMode }) {
      if (window.self !== window.top || supported || storageMode === "server")
        return;
      const warning = document.getElementById("file-access-warning");
      const warningText = document.getElementById("file-access-warning-text");
      const help = document.getElementById("file-access-help");
      let isBrave = false;
      try {
        isBrave = (await navigator.brave?.isBrave?.()) === true;
      } catch {
        // Browser detection is advisory only.
      }
      warningText.textContent = isBrave
        ? "Brave has its File System Access API disabled. Click the address, paste it into the address bar, enable the flag, and relaunch Brave."
        : "This browser cannot overwrite opened files. Use Chrome or Edge for direct Ctrl+S saving.";
      help.hidden = !isBrave;
      help.onclick = async () => {
        try {
          await navigator.clipboard.writeText(BRAVE_FILE_ACCESS_URL);
          setStatus("Brave File System Access flag address copied");
        } catch {
          window.prompt("Copy this address into Brave", BRAVE_FILE_ACCESS_URL);
        }
      };
      warning.hidden = false;
      document.body.classList.add("file-access-warning-visible");
    },
  };
}
