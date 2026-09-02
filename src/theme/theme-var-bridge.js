// ---- theme-var-bridge: make --spice-* variables actually DO something ----
// The gap theme-dom-patch.js doesn't close: most spicetify community themes
// are just a color.ini -> a list of --spice-* variables, with no CSS of
// their own. On desktop, spicetify's bundled xpui.css is what *consumes*
// those variables against every element. We don't have that stylesheet
// here, so a theme can load perfectly (--spice-main set correctly etc.) and
// still visibly do nothing, because nothing on the page ever reads
// --spice-main.
//
// Fix: ship that consuming stylesheet ourselves. The --spice-* variable
// names are stable and documented by spicetify itself (color.ini spec) --
// unlike class hashes or Encore's internal --encore-* tokens, which aren't
// public and churn between deploys, this is the one part of the theme
// contract we can rely on. So: inject one <style> block that maps every
// standard --spice-* var directly onto real, stable data-testid selectors,
// with !important so it wins over Spotify's own inline Encore colors.
(function ThemeVarBridge() {
  const CSS = `
    :root, html, body {
      background-color: var(--spice-main, #121212) !important;
      color: var(--spice-text, #fff) !important;
    }

    /* Sidebar / nav */
    nav[aria-label="Main"],
    [data-testid="global-nav-bar"],
    [aria-label="Your Library"],
    [data-testid="left-sidebar"] {
      background-color: var(--spice-sidebar, #000) !important;
    }
    [data-testid="rootlist-item"] a,
    nav[aria-label="Main"] a {
      color: var(--spice-subtext, #a7a7a7) !important;
    }
    [data-testid="rootlist-item"] a[aria-current="page"],
    nav[aria-label="Main"] a[aria-current="page"] {
      color: var(--spice-tab-active, var(--spice-text, #fff)) !important;
    }

    /* Now playing bar */
    [data-testid="now-playing-widget"],
    [data-testid="now-playing-bar"] {
      background-color: var(--spice-player, #181818) !important;
    }
    [data-testid="context-item-info-title"] {
      color: var(--spice-text, #fff) !important;
    }
    [data-testid="context-item-info-artist"] {
      color: var(--spice-subtext, #a7a7a7) !important;
    }

    /* Transport controls */
    [data-testid="control-button-playpause"] {
      background-color: var(--spice-button, #1ed760) !important;
      color: var(--spice-main, #121212) !important;
    }
    [data-testid="control-button-playpause"]:hover,
    [data-testid="control-button-playpause"]:active {
      background-color: var(--spice-button-active, #169c46) !important;
    }
    [data-testid="control-button-shuffle"][aria-checked="true"],
    [data-testid="control-button-repeat"][aria-checked="true"] {
      color: var(--spice-button, #1ed760) !important;
    }

    /* Progress + volume bars */
    [data-testid="playback-progressbar"] [role="slider"],
    [data-testid="volume-bar"] input[type="range"] {
      accent-color: var(--spice-button, #1ed760) !important;
    }

    /* Cards (album/playlist/artist grid) */
    [data-testid="card-container"],
    [data-testid="card-content"] {
      background-color: var(--spice-card, #1a1a1a) !important;
    }
    [data-testid="card-title"],
    [data-testid="entityTitle"] {
      color: var(--spice-text, #fff) !important;
    }

    /* Track list rows */
    [data-testid="tracklist-row"]:hover,
    [role="row"][aria-rowindex]:hover {
      background-color: var(--spice-highlight-elevated, var(--spice-card, #2a2a2a)) !important;
    }
    [data-testid="tracklist-row"][aria-selected="true"] {
      background-color: var(--spice-selected-row, rgba(255,255,255,.1)) !important;
    }

    /* Main content area */
    main[role="main"],
    [data-testid="main-view-container"] {
      background-color: var(--spice-main, #121212) !important;
    }

    /* Context menus / modals */
    [data-testid="context-menu"],
    [role="dialog"] {
      background-color: var(--spice-card, #282828) !important;
      color: var(--spice-text, #fff) !important;
    }

    /* Search */
    [data-testid="search-input"] {
      background-color: var(--spice-misc, #2a2a2a) !important;
      color: var(--spice-text, #fff) !important;
    }

    /* Scrollbars */
    ::-webkit-scrollbar-thumb {
      background-color: var(--spice-misc, #4e4e4e) !important;
    }
  `;

  function inject() {
    if (document.getElementById("spicetify-web-var-bridge")) return;
    const style = document.createElement("style");
    style.id = "spicetify-web-var-bridge";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  Spicetify.Events.webpackLoaded.on(inject);
})();
