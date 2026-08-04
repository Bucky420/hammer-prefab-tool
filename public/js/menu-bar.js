export function bindMenuBar({ run }) {
  globalThis.__hptMenuBarCleanup?.();
  const listeners = new AbortController();
  const menus = [...document.querySelectorAll(".drop-menu")];
  const triggers = [...document.querySelectorAll("[data-menu]")];

  const close = () => {
    menus.forEach((item) => item.classList.remove("open"));
    triggers.forEach((item) => {
      item.classList.remove("active");
      item.setAttribute("aria-expanded", "false");
    });
  };
  const open = (button) => {
    const menu = document.getElementById(button.dataset.menu);
    menu.classList.add("open");
    button.classList.add("active");
    button.setAttribute("aria-expanded", "true");
    menu.style.left = `${button.getBoundingClientRect().left}px`;
    return menu;
  };

  document.querySelectorAll(".drop-menu [data-command]").forEach((button) => {
    button.onclick = () => {
      run(button.dataset.command);
      close();
    };
  });
  triggers.forEach((button) => {
    button.addEventListener(
      "mouseenter",
      () => {
        if (!menus.some((menu) => menu.classList.contains("open"))) return;
        close();
        open(button);
      },
      { signal: listeners.signal },
    );
    button.onclick = (event) => {
      event.stopPropagation();
      const opening = !document
        .getElementById(button.dataset.menu)
        .classList.contains("open");
      close();
      if (opening)
        open(button)
          .querySelector("button:not([hidden]):not(:disabled), input, select")
          ?.focus();
    };
  });
  document.addEventListener(
    "pointermove",
    (event) => {
      if (
        menus.some((menu) => menu.classList.contains("open")) &&
        !event.target.closest(".menu-bar") &&
        !event.target.closest(".drop-menu")
      )
        close();
    },
    { signal: listeners.signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !event.target.closest(".menu-bar") &&
        !event.target.closest(".drop-menu")
      )
        close();
    },
    { signal: listeners.signal },
  );
  globalThis.__hptMenuBarCleanup = () => listeners.abort();

  return {
    close,
    closeForEscape() {
      if (!menus.some((menu) => menu.classList.contains("open"))) return false;
      const trigger = document.querySelector("[data-menu].active");
      close();
      trigger?.focus();
      return true;
    },
  };
}
