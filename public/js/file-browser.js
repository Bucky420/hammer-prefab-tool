const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );

function wildcard(expression) {
  const query = expression.trim();
  const pattern = query.includes("*") ? query : `*${query}*`;
  return new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  );
}

export function bindFileBrowser({ loadFiles, openFile }) {
  const dialog = document.getElementById("project-browser");
  const search = document.getElementById("file-search");
  const list = document.getElementById("browser-list");
  const status = document.getElementById("browser-status");
  let files = [];
  let visibleFiles = [];
  let selected = null;

  const render = () => {
    if (!visibleFiles.length) {
      list.innerHTML = `<p class="browser-empty">No files match this search.</p>`;
      return;
    }
    list.innerHTML = visibleFiles
      .map(
        (file, index) =>
          `<button type="button" data-file="${index}" class="${selected?.name === file.name ? "active" : ""}"><span>${escapeHtml(file.name)}</span><small>${new Date(file.modified).toLocaleString()} · ${file.size} B</small></button>`,
      )
      .join("");
    list.querySelectorAll("[data-file]").forEach((button) => {
      button.onclick = () => {
        selected = visibleFiles[Number(button.dataset.file)];
        render();
      };
      button.ondblclick = activateSelected;
    });
  };
  const filter = () => {
    const query = search.value.trim();
    const matcher = query ? wildcard(query) : null;
    visibleFiles = files.filter((file) => !matcher || matcher.test(file.name));
    selected = null;
    render();
  };
  async function activateSelected() {
    if (!selected) return;
    try {
      if (await openFile(selected)) dialog.close();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  search.value = localStorage.getItem("hammer-vmf-search") || "";
  search.oninput = () => {
    localStorage.setItem("hammer-vmf-search", search.value);
    filter();
  };
  search.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && selected) {
      event.preventDefault();
      void activateSelected();
    }
  };

  return {
    async open() {
      selected = null;
      dialog.querySelector("strong").textContent = "OPEN VMF";
      status.textContent = "Loading...";
      dialog.showModal();
      search.focus();
      try {
        files = (await loadFiles()).filter((file) =>
          file.name.toLowerCase().endsWith(".vmf"),
        );
        filter();
        status.textContent = `${files.length} VMF file${files.length === 1 ? "" : "s"} · double-click to open`;
        search.focus();
      } catch (error) {
        files = [];
        visibleFiles = [];
        render();
        status.textContent = error.message;
      }
    },
    close() {
      dialog.close();
    },
    isOpen() {
      return dialog.open;
    },
  };
}
