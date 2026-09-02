// ---- theme-dom-patch: make spicetify theme CSS apply to the web player ----
// Spicetify themes target desktop class names (.main-trackInfo-name,
// .Root__top-container, etc.).  The web player uses per-build CSS-module
// hashes that change on every deploy, so theme CSS never matches anything.
//
// Fix: mirror desktop class names onto web elements, keyed off data-testid /
// data-encore-id / aria-* which Spotify keeps stable across redesigns.
// Theme CSS written against desktop class names then has something to hook
// onto.  The map is applied on every React re-render (throttled via rAF).
//
// Also stamps <body> + <html> with the class-set and data attributes that
// spicetify itself adds so body/root-level theme selectors work too.

const SW_MAP = [
  // ── Now-playing bar ─────────────────────────────────────────────────────
  ['[data-testid="now-playing-widget"]',                   "main-nowPlayingBar-nowPlayingBar main-nowPlayingBar-container"],
  ['[data-testid="now-playing-bar"]',                      "main-nowPlayingBar-nowPlayingBar main-nowPlayingBar-container"],
  ['[data-testid="context-item-info-title"]',              "main-trackInfo-name"],
  ['[data-testid="context-item-info-artist"]',             "main-trackInfo-artists main-trackInfo-artist"],
  ['[data-testid="context-item-link"]',                    "main-trackInfo-container"],
  ['[data-testid="context-item-info-album"]',              "main-trackInfo-album"],

  // Album art in the now-playing bar
  ['[data-testid="CoverSlotExpanded__container"]',         "main-nowPlayingWidget-coverArt"],
  ['[data-testid="cover-art"]',                            "main-coverSlotExpanded-container"],
  ['[data-testid="now-playing-widget"] img',               "main-image-image"],

  // ── Playback progress bar ────────────────────────────────────────────────
  ['[data-testid="playback-progressbar"]',                 "playback-bar main-playbackProgressBar-progressBar"],
  ['[data-testid="playback-progressbar"] [role="slider"]', "playback-bar__progress-time-container"],
  ['[data-testid="playback-position"]',                    "playback-bar__progress-time main-playbackProgressBar-positionTime"],
  ['[data-testid="playback-duration"]',                    "playback-bar__progress-time main-playbackProgressBar-durationTime"],

  // ── Playback controls ────────────────────────────────────────────────────
  ['[data-testid="control-button-playpause"]',             "player-controls__buttons main-playPauseButton-button"],
  ['[data-testid="control-button-skip-forward"]',          "player-controls__buttons main-skipForwardButton-button"],
  ['[data-testid="control-button-skip-back"]',             "player-controls__buttons main-skipBackButton-button"],
  ['[data-testid="control-button-shuffle"]',               "main-shuffleButton-button player-controls__buttons"],
  ['[data-testid="control-button-repeat"]',                "main-repeatButton-button player-controls__buttons"],
  ['[data-testid="control-button-lyrics"]',                "player-controls__buttons"],

  // Heart / add-to-library button in the now-playing bar
  ['[data-testid="add-button"]',                           "main-addButton-button"],

  // ── Volume ───────────────────────────────────────────────────────────────
  ['[data-testid="volume-bar"]',                           "volume-bar main-nowPlayingWidget-volume"],
  ['[data-testid="volume-bar"] input[type="range"]',       "volume-bar__slider"],

  // ── Navigation / sidebars ────────────────────────────────────────────────
  ['nav[aria-label="Main"]',                               "Root__nav-bar main-navBar-navBar main-yourLibraryX-navItems"],
  ['[data-testid="global-nav-bar"]',                       "Root__globalNav main-globalNav"],
  ['[data-testid="left-sidebar"]',                         "Root__nav-bar main-yourLibraryX-entryPoints"],
  ['[data-testid="left-sidebar-panel"]',                   "main-yourLibraryX-libraryContainer"],
  ['[aria-label="Your Library"]',                          "main-yourLibrary-library"],

  // Library nav links / items
  ['[data-testid="rootlist-item"]',                        "main-rootlist-rootlistItem"],
  ['[data-testid="rootlist-item"] a',                      "main-rootlist-rootlistItemLink"],
  ['[data-testid="rootlist-item-link"]',                   "main-yourLibraryX-listItem"],
  ['[data-testid="rootlist-item"] img',                    "main-image-image main-rootlist-rootlistItemImage"],

  // ── Top bar / search ─────────────────────────────────────────────────────
  ['[data-testid="topbar-content-wrapper"]',               "main-topBar-topbarContentWrapper"],
  ['[data-testid="global-nav-bar"] header',                "main-topBar-header"],
  ['[data-testid="topbar-forward-button"]',                "main-topBar-forward"],
  ['[data-testid="topbar-back-button"]',                   "main-topBar-back"],
  ['[data-testid="search-container"]',                     "x-searchInput-searchInputContainer main-globalNav-searchContainer"],
  ['[data-testid="search-input"]',                         "x-searchInput-searchInputInput main-topBar-searchBar"],

  // ── Main view / content area ─────────────────────────────────────────────
  ['main[role="main"]',                                    "Root__main-view main-view-container"],
  ['[data-testid="main-view-container"]',                  "Root__main-view main-view-container"],
  ['[data-testid="page-content"]',                         "main-view-container__scroll-node-child"],

  // Entity / playlist header
  ['[data-testid="playlist-page"] header',                 "main-entityHeader-container"],
  ['[data-testid="entity-header-image"]',                  "main-entityHeader-image"],
  ['[data-testid="entityTitle"]',                          "main-entityHeader-title"],
  ['[data-testid="entity-page"]',                          "main-entityPage-container"],

  // Track list rows
  ['[data-testid="tracklist-row"]',                        "main-trackList-trackListRow"],
  ['[data-testid="track-container"]',                      "main-trackList-trackListRow"],
  ['[role="row"][aria-rowindex]',                          "main-trackList-trackListRow"],
  ['[data-testid="tracklist-row"] [data-testid="tracklist-column-index"]', "main-trackList-rowSectionIndex"],
  ['[data-testid="tracklist-row"] [data-testid="tracklist-column-title"]', "main-trackList-rowTitle"],
  ['[data-testid="tracklist-row"] img',                    "main-image-image"],

  // Cards (album/artist/playlist grid)
  ['[data-testid="card-content"]',                         "main-card-content"],
  ['[data-testid="card-title"]',                           "main-card-cardMetadata"],
  ['[data-testid="card-container"]',                       "main-card-card"],

  // ── Search ───────────────────────────────────────────────────────────────
  ['[data-testid="search-input"]',                         "x-searchInput-searchInputInput"],
  ['[data-testid="search-container"]',                     "x-searchInput-searchInputContainer"],

  // ── Right sidebar / now playing sidebar ──────────────────────────────────
  ['[data-testid="right-sidebar"]',                        "Root__right-sidebar main-buddyFeed-container"],
  ['[data-testid="lyrics-page-container"]',                "lyrics-lyricsContainer"],

  // ── Context menu ─────────────────────────────────────────────────────────
  ['[data-testid="context-menu"]',                         "main-contextMenu-menu context-menu"],
  ['[data-testid="context-menu"] li button',               "main-contextMenu-menuItemButton"],

  // ── Modals / alerts ──────────────────────────────────────────────────────
  ['[role="dialog"]',                                      "main-modal-container"],
  ['[role="dialog"] [role="heading"]',                     "main-modal-header"],
];

function swApplyClass(el, classAttr) {
  classAttr.split(" ").forEach((c) => { if (c) el.classList.add(c); });
}

function swPatchOnce(root) {
  SW_MAP.forEach(([sel, classes]) => {
    Spicetify._dom.qs_all(sel, root).forEach((el) => swApplyClass(el, classes));
  });
}

function swPatchBody() {
  // Desktop spicetify stamps these on <body> — themes key off them for
  // platform/theme-mode specifics.
  document.documentElement.classList.add("encore-dark-theme", "spicetify-web");
  document.body.classList.add(
    "main-view-container--scrollNodeIsSet",
    "encore-dark-theme",
    // spicetify sets these on the root element to identify the build:
    "Root"
  );
  document.body.setAttribute("data-spicetify-web", "1");

  // --spice-* CSS custom property bridge: if a theme injects them via :root
  // they should already be inherited; this ensures the player background var
  // is at least set to something sensible if the theme doesn't cover the web.
  // Only set if not already defined by an injected theme stylesheet.
  const style = document.documentElement.style;
  if (!style.getPropertyValue("--spice-main")) {
    // No theme active — set Spotify default dark values so our UI chrome
    // (toasts, popup modal, playbar buttons) looks reasonable.
    const defaults = {
      "--spice-main": "#121212",
      "--spice-sidebar": "#000",
      "--spice-player": "#181818",
      "--spice-card": "#1a1a1a",
      "--spice-subtext": "#a7a7a7",
      "--spice-text": "#ffffff",
      "--spice-button": "#1ed760",
      "--spice-button-active": "#169c46",
      "--spice-button-disabled": "#535353",
      "--spice-tab-active": "#ffffff",
      "--spice-notification": "#1ed760",
      "--spice-notification-error": "#e91429",
      "--spice-misc": "#4e4e4e",
      "--spice-shadow": "0,0,0",
      "--spice-rgb-main": "18,18,18",
      "--spice-rgb-text": "255,255,255",
      "--spice-rgb-shadow": "0,0,0",
    };
    Object.entries(defaults).forEach(([k, v]) => style.setProperty(k, v));
  }
}

// Some themes (e.g. spicetify's "text" theme) label each UI region with
// injected CSS content (\"Nav\", \"Library\", \"Main\"...) via ::before rules
// keyed off a `:has()` chain that only matches desktop's exact DOM nesting.
// Rather than replicate that nesting here -- which would mean moving live
// React-managed elements around and risking breaking React's own tracking
// of them -- this recreates the same visual labels against our own stable
// data-testid selectors directly. Uses --spice-header / --font-family-header
// if a theme defines them, so it still matches whatever theme is loaded;
// otherwise falls back to something reasonable.
function swInjectSectionLabels() {
  if (document.getElementById("spicetify-web-section-labels")) return;
  const style = document.createElement("style");
  style.id = "spicetify-web-section-labels";
  style.textContent = `
    [data-testid="global-nav-bar"],
    [data-testid="left-sidebar"],
    main[role="main"],
    [data-testid="now-playing-widget"],
    [data-testid="right-sidebar"] {
      position: relative;
    }
    [data-testid="global-nav-bar"]::before,
    [data-testid="left-sidebar"]::before,
    main[role="main"]::before,
    [data-testid="now-playing-widget"]::before,
    [data-testid="right-sidebar"]::before {
      position: absolute;
      top: 0; left: 4px;
      margin-top: -10px;
      padding: 0 3px;
      font-family: var(--font-family-header, inherit);
      font-size: 11px;
      color: var(--spice-header, var(--spice-subtext, #a7a7a7));
      background: var(--spice-main, #121212);
      z-index: 3;
      pointer-events: none;
    }
    [data-testid="global-nav-bar"]::before      { content: "Nav"; }
    [data-testid="left-sidebar"]::before        { content: "Library"; }
    main[role="main"]::before                   { content: "Main"; }
    [data-testid="now-playing-widget"]::before  { content: "Playing"; }
    [data-testid="right-sidebar"]::before       { content: "Sidebar"; }
  `;
  document.head.appendChild(style);
}

Spicetify.Events.webpackLoaded.on(() => {
  if (!DispotSettings.isEnabled("spicetify-theming", true)) return;
  swPatchBody();
  swPatchOnce(document);
  swInjectSectionLabels();

  // React re-renders wipe manually-added classes constantly; keep re-stamping.
  // Throttled with rAF to avoid fighting React on every single mutation.
  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      swPatchOnce(document);
      scheduled = false;
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
});
