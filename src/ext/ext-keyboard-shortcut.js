// ---- ext: keyboard shortcuts (ported from spicetify/cli keyboardShortcut.js) ----
// Registers extra keybinds for keyboard-driven navigation in the web player.
// Uses Spicetify.Mousetrap (shimmed in 01-shim.js) and Spicetify.Keyboard.KEYS.
// Vim-mode (f key overlay) is included but requires many visible elements —
// it works best on desktop; on the web player it's a best-effort.
(function KeyboardShortcut() {
  if (!Spicetify.Mousetrap) { setTimeout(KeyboardShortcut, 1000); return; }

  const SCROLL_STEP = 25;

  function focusOnApp() {
    return document.querySelector(
      ".Root__main-view .os-viewport, .Root__main-view .main-view-container > .main-view-container__scroll-node:not([data-overlayscrollbars-initialize]), .Root__main-view .main-view-container__scroll-node > [data-overlayscrollbars-viewport], main[role='main']"
    );
  }

  function createScrollCallback(step) {
    const app = focusOnApp();
    if (!app) return;
    const id = setInterval(() => { app.scrollTop += step; }, 10);
    document.addEventListener("keyup", () => clearInterval(id), { once: true });
  }

  function scrollToPosition(pos) {
    const app = focusOnApp();
    if (app) app.scroll(0, pos === 0 ? 0 : app.scrollHeight);
  }

  function rotateSidebar(direction) {
    const allItems = document.querySelectorAll(
      "#spicetify-sticky-list .main-yourLibraryX-navLink, .main-yourLibraryX-listItem > div:not(:has([data-skip-in-keyboard-nav])) > div:first-child, [data-testid='rootlist-item']"
    );
    if (!allItems.length) return;
    const max = allItems.length - 1;
    const active = document.querySelector(".main-yourLibraryX-navLinkActive, [aria-current='page']");
    let idx = -1;
    allItems.forEach((el, i) => { if (el === active || el.contains(active)) idx = i; });
    idx = (idx + direction + allItems.length) % (max + 1);
    allItems[idx].click();
  }

  const binds = {
    "ctrl+tab":       () => rotateSidebar(1),
    "ctrl+shift+tab": () => rotateSidebar(-1),
    "j":              () => createScrollCallback(SCROLL_STEP),
    "k":              () => createScrollCallback(-SCROLL_STEP),
    "g g":            () => scrollToPosition(0),
    "shift+g":        () => scrollToPosition(1),
    "m":              () => Spicetify.Player.toggleHeart(),
    "/":              () => {
      const searchEl = document.querySelector('[data-testid="search-input"]');
      if (searchEl) { searchEl.focus(); searchEl.select(); }
    },
    "ctrl+left":      () => Spicetify.Player.back(),
    "ctrl+right":     () => Spicetify.Player.next(),
    "ctrl+up":        () => Spicetify.Player.setVolume(Math.min(1, Spicetify.Player.getVolume() + 0.05)),
    "ctrl+down":      () => Spicetify.Player.setVolume(Math.max(0, Spicetify.Player.getVolume() - 0.05)),
    "space":          () => Spicetify.Player.togglePlay(),
  };

  for (const [key, cb] of Object.entries(binds)) {
    Spicetify.Mousetrap.bind(key, (e) => { e.preventDefault(); cb(e); });
  }
})();
