// ==UserScript==
// @name         dispot
// @namespace    https://github.com/HimadriChakra12/dispot
// @version      1.0.0
// @description  A spicetify alike userscript for better spotify experience
// @match        https://open.spotify.com/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

// ---- start.js ----
(() => {
  'use strict';

// ---- shim.js ----
// ---- shim: Spicetify-compatible surface for open.spotify.com ----
// Real spicetify hooks Spotify's own internal JS modules inside the desktop
// Electron app. Those modules aren't reachable from a page-context userscript
// on the web player, and their webpack chunk IDs change on every deploy, so
// hard-coding them breaks in days. Instead this shim rebuilds the pieces
// extensions actually touch from stable DOM anchors: data-testid attributes,
// the native <audio>/MediaSession API, and window.localStorage.
// Goal: "extensions from spicetify/cli run with minimal edits", not 1:1 parity.
//
// APIs implemented here:
//   Spicetify.LocalStorage
//   Spicetify.showNotification
//   Spicetify.Player  (data, events, controls, getters/setters)
//   Spicetify.Menu.Item
//   Spicetify.Topbar.Button
//   Spicetify.Playbar.Button / Playbar.Widget
//   Spicetify.ContextMenu.Item
//   Spicetify.PopupModal
//   Spicetify.SVGIcons (subset)
//   Spicetify.URI     (subset: fromString, isTrack, isLocalTrack, isPlaylistV1OrV2, Type)
//   Spicetify.Keyboard.KEYS
//   Spicetify.Mousetrap (thin wrapper around the bundled Mousetrap lib, or a
//                        minimal fallback if Mousetrap isn't on the page)
//   Spicetify.Events.webpackLoaded
//   Spicetify._dom   (qs, qs_all, waitFor — internal helpers)

const SW_PREFIX = "dispot:";

function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function waitFor(check, timeoutMs) {
  return new Promise((resolve) => {
    if (check()) return resolve(check());
    const mo = new MutationObserver(() => {
      const v = check();
      if (v) { mo.disconnect(); resolve(v); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    if (timeoutMs) setTimeout(() => { mo.disconnect(); resolve(check()); }, timeoutMs);
  });
}

// ---- Spicetify.LocalStorage --------------------------------------------
const swLocalStorage = {
  get(key) { return window.localStorage.getItem(SW_PREFIX + key); },
  set(key, val) { window.localStorage.setItem(SW_PREFIX + key, val); },
  remove(key) { window.localStorage.removeItem(SW_PREFIX + key); },
};

// ---- Spicetify.showNotification ----------------------------------------
let swToastRoot = null;
function swShowNotification(text, isError) {
  if (!swToastRoot) {
    swToastRoot = document.createElement("div");
    swToastRoot.id = "spicetify-web-toasts";
    swToastRoot.style.cssText =
      "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);" +
      "z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
    document.body.appendChild(swToastRoot);
  }
  const toast = document.createElement("div");
  toast.textContent = text;
  toast.style.cssText =
    "background:" + (isError ? "#e91429" : "#1ed760") + ";color:#000;font-weight:700;" +
    "padding:10px 18px;border-radius:24px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.4);" +
    "opacity:0;transition:opacity .2s ease;";
  swToastRoot.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = "1"; });
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// ---- track state, read from the DOM (the "now playing" bar) ------------
// data-testid attributes are stable across redesigns; class hashes are not.
function swReadNowPlaying() {
  const titleEl = qs('[data-testid="context-item-info-title"]');
  const artistEl = qs('[data-testid="context-item-info-artist"]');
  const audio = qs("audio");
  const explicitBadge = qs('[data-encore-id="badge"][aria-label="Explicit"], [aria-label="Explicit"], .explicit-badge');
  if (!titleEl) return null;

  // Album art: web player puts it inside the now-playing widget
  const artImg = qs('[data-testid="CoverSlotExpanded__container"] img, [data-testid="cover-art"] img, [data-testid="now-playing-widget"] img');
  const imageUrl = artImg ? artImg.src : "";
  // xlarge variant: swap size suffix if present, else use same src
  const imageXlargeUrl = imageUrl.replace(/\/image\/([a-f0-9]+)$/, "/image/$1").replace("ab67616d00001e02", "ab67616d000082c1") || imageUrl;

  // Album title from the bar
  const albumLink = qs('[data-testid="context-item-info-album"] a, [data-testid="context-item-info-album"]');

  // Artist URI: try href of artist link
  const artistLink = artistEl ? artistEl.closest("a") : null;
  const artistHref = artistLink ? artistLink.href : "";
  const artistUriMatch = artistHref.match(/artist\/([a-zA-Z0-9]+)/);
  const artistUri = artistUriMatch ? "spotify:artist:" + artistUriMatch[1] : "";

  // Track URI from the anchor wrapping the title
  const titleLink = titleEl.closest("a");
  const trackHref = titleLink ? titleLink.href : "";
  const trackMatch = trackHref.match(/track\/([a-zA-Z0-9]+)/);
  const trackUri = trackMatch ? "spotify:track:" + trackMatch[1] : (titleLink ? titleLink.href : "");

  // Duration/position from <audio>
  const duration = (audio && !isNaN(audio.duration)) ? Math.round(audio.duration * 1000) : 0;
  const position = (audio && !isNaN(audio.currentTime)) ? Math.round(audio.currentTime * 1000) : 0;

  // isPaused
  const playBtn = qs('[data-testid="control-button-playpause"]');
  const isPaused = playBtn ? /play/i.test(playBtn.getAttribute("aria-label") || "") : true;

  // Repeat state (0=off,1=context,2=one): button aria-label
  const repeatBtn = qs('[data-testid="control-button-repeat"]');
  let repeatVal = 0;
  if (repeatBtn) {
    const rl = (repeatBtn.getAttribute("aria-label") || "").toLowerCase();
    if (/repeat one/i.test(rl) || repeatBtn.getAttribute("aria-checked") === "true") {
      // Spotify uses different labels; check data attr too
      const repState = repeatBtn.getAttribute("data-encore-id") || rl;
      if (/one/i.test(repState)) repeatVal = 2; else repeatVal = 1;
    } else if (/repeat off/i.test(rl) || /enable repeat/i.test(rl)) {
      repeatVal = 0;
    } else if (/repeat/i.test(rl)) {
      repeatVal = 1;
    }
  }

  // Shuffle state
  const shuffleBtn = qs('[data-testid="control-button-shuffle"]');
  const isShuffled = shuffleBtn ? shuffleBtn.getAttribute("aria-checked") === "true" : false;

  // Heart / saved state
  const heartBtn = qs('[data-testid="add-button"], [aria-label="Save to Your Library"], [aria-label="Remove from Your Library"]');
  const isHearted = heartBtn ? /remove/i.test(heartBtn.getAttribute("aria-label") || "") : false;

  return {
    title: titleEl.textContent || "",
    artist: artistEl ? artistEl.textContent : "",
    artistUri,
    album: albumLink ? albumLink.textContent : "",
    imageUrl,
    imageXlargeUrl,
    isExplicit: !!explicitBadge,
    uri: trackUri,
    duration,
    position,
    isPaused,
    repeat: repeatVal,
    shuffle: isShuffled,
    isHearted,
  };
}

// ---- Spicetify.Player --------------------------------------------------
const swPlayerListeners = {};
let swLastTrackKey = null;
let swProgressInterval = null;
let swLastEmittedProgress = -1;

const swPlayer = {
  get data() {
    const np = swReadNowPlaying();
    if (!np) return null;
    return {
      item: {
        uri: np.uri,
        uid: "",
        metadata: {
          title: np.title,
          artist_name: np.artist,
          artist_uri: np.artistUri,
          album_title: np.album,
          is_explicit: np.isExplicit ? "true" : "false",
          image_url: np.imageUrl,
          image_xlarge_url: np.imageXlargeUrl,
          duration: String(np.duration),
          // media.type not knowable from DOM; default to "audio"
          "media.type": "audio",
          is_advertisement: "false",
        },
      },
      isPaused: np.isPaused,
      repeat: np.repeat,
      shuffle: np.shuffle,
    };
  },

  addEventListener(name, cb) {
    if (!swPlayerListeners[name]) swPlayerListeners[name] = [];
    swPlayerListeners[name].push(cb);
  },
  removeEventListener(name, cb) {
    if (!swPlayerListeners[name]) return;
    swPlayerListeners[name] = swPlayerListeners[name].filter((f) => f !== cb);
  },

  // Transport controls
  next()       { const b = qs('[data-testid="control-button-skip-forward"]'); if (b) b.click(); },
  back()       { const b = qs('[data-testid="control-button-skip-back"]');    if (b) b.click(); },
  togglePlay() { const b = qs('[data-testid="control-button-playpause"]');    if (b) b.click(); },
  play() {
    const b = qs('[data-testid="control-button-playpause"]');
    if (b && /play/i.test(b.getAttribute("aria-label") || "")) b.click();
  },
  pause() {
    const b = qs('[data-testid="control-button-playpause"]');
    if (b && /pause/i.test(b.getAttribute("aria-label") || "")) b.click();
  },
  seek(positionMs) {
    // Spicetify.Player.seek accepts milliseconds on desktop; but audio.currentTime is seconds.
    const audio = qs("audio");
    if (!audio) return;
    // If called with a value <10 treat as fractional (0-1 percent); otherwise ms.
    if (positionMs <= 1 && positionMs >= 0) {
      audio.currentTime = positionMs * audio.duration;
    } else {
      audio.currentTime = positionMs / 1000;
    }
  },

  // Volume
  getVolume() {
    const audio = qs("audio");
    return audio ? audio.volume : 1;
  },
  setVolume(fraction) {
    const audio = qs("audio");
    if (audio) audio.volume = Math.max(0, Math.min(1, fraction));
    // Also try to drag the volume slider via input event
    const volInput = qs('[data-testid="volume-bar"] input[type="range"]');
    if (volInput) {
      const pct = Math.round(fraction * 100);
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(volInput, pct);
      volInput.dispatchEvent(new Event("input", { bubbles: true }));
      volInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  },

  // Progress
  getProgress() {
    const audio = qs("audio");
    return audio ? Math.round(audio.currentTime * 1000) : 0;
  },
  getProgressPercent() {
    const audio = qs("audio");
    if (!audio || !audio.duration) return 0;
    return audio.currentTime / audio.duration;
  },
  getDuration() {
    const audio = qs("audio");
    return audio ? Math.round(audio.duration * 1000) : 0;
  },
  formatTime(ms) {
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  },

  // State queries
  isPlaying() {
    const np = swReadNowPlaying();
    return np ? !np.isPaused : false;
  },
  getRepeat() {
    const np = swReadNowPlaying();
    return np ? np.repeat : 0;
  },
  toggleRepeat() {
    const b = qs('[data-testid="control-button-repeat"]');
    if (b) b.click();
  },
  getShuffle() {
    const np = swReadNowPlaying();
    return np ? np.shuffle : false;
  },
  toggleShuffle() {
    const b = qs('[data-testid="control-button-shuffle"]');
    if (b) b.click();
  },
  getHeart() {
    const np = swReadNowPlaying();
    return np ? np.isHearted : false;
  },
  toggleHeart() {
    const b = qs('[data-testid="add-button"], [aria-label="Save to Your Library"], [aria-label="Remove from Your Library"]');
    if (b) b.click();
  },
};

// ---- emit helpers -------------------------------------------------------
function swEmit(name, detail) {
  (swPlayerListeners[name] || []).forEach((cb) => {
    try { cb({ data: swPlayer.data, detail: detail, timeStamp: performance.now() }); }
    catch (e) { console.error("[spicetify-web]", e); }
  });
}

function swStartProgressPolling() {
  if (swProgressInterval) return;
  swProgressInterval = setInterval(() => {
    const audio = qs("audio");
    if (!audio || audio.paused) return;
    const ms = Math.round(audio.currentTime * 1000);
    if (ms !== swLastEmittedProgress) {
      swLastEmittedProgress = ms;
      swEmit("onprogress", ms);
    }
  }, 250);
}

function swWatchPlayback() {
  const bar = qs('[data-testid="now-playing-widget"]') || document.body;
  const mo = new MutationObserver(() => {
    const np = swReadNowPlaying();
    if (!np) return;
    const key = np.uri + "|" + np.title;
    if (key !== swLastTrackKey) {
      swLastTrackKey = key;
      swEmit("songchange");
    }
  });
  mo.observe(bar, { childList: true, subtree: true, characterData: true });

  const playBtn = qs('[data-testid="control-button-playpause"]');
  if (playBtn) {
    playBtn.addEventListener("click", () => setTimeout(() => swEmit("onplaypause"), 50));
  }

  swStartProgressPolling();

  // Also watch the audio element directly for play/pause
  const audio = qs("audio");
  if (audio) {
    audio.addEventListener("play",  () => swEmit("onplaypause"));
    audio.addEventListener("pause", () => swEmit("onplaypause"));
  }
}

// ---- Spicetify.Menu.Item -----------------------------------------------
// Inject into the profile dropdown. The profile menu is a <ul role="menu">
// that only exists in the DOM while open. Patch it in on open.
function SwMenuItem(name, isEnabled, onClick, icon) {
  this.name = name;
  this.isEnabled = isEnabled;
  this.onClick = onClick;
  this.icon = icon || null;
  this.el = null;
}
SwMenuItem.prototype.setState = function(state) {
  this.isEnabled = state;
  if (this.el) {
    this.el.setAttribute("aria-checked", state ? "true" : "false");
    this.el.querySelector(".sw-menu-check").textContent = state ? "\u2713 " : "\u2610 ";
  }
};
SwMenuItem.prototype.register = function() {
  swMenuItems.push(this);
  swRenderMenuItems();
};
SwMenuItem.prototype.deregister = function() {
  swMenuItems.splice(swMenuItems.indexOf(this), 1);
};

const swMenuItems = [];
function swRenderMenuItems() {
  document.addEventListener("click", (ev) => {
    const trigger = ev.target.closest('[data-testid="user-widget-link"], [data-testid="user-widget-dropdown"]');
    if (!trigger) return;
    waitFor(() => qs('ul[role="menu"]'), 1000).then((menu) => {
      if (!menu || menu.dataset.swPatched) return;
      menu.dataset.swPatched = "1";
      swMenuItems.forEach((item) => {
        const li = document.createElement("li");
        li.setAttribute("role", "menuitem");
        li.setAttribute("aria-checked", item.isEnabled ? "true" : "false");
        const check = document.createElement("span");
        check.className = "sw-menu-check";
        check.textContent = item.isEnabled ? "\u2713 " : "\u2610 ";
        li.appendChild(check);
        li.appendChild(document.createTextNode(item.name));
        li.style.cssText = "padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;";
        li.addEventListener("click", () => {
          item.onClick(item);
          li.setAttribute("aria-checked", item.isEnabled ? "true" : "false");
          check.textContent = item.isEnabled ? "\u2713 " : "\u2610 ";
        });
        item.el = li;
        menu.appendChild(li);
      });
    });
  }, true);
}

// ---- Spicetify.Topbar.Button -------------------------------------------
// Injects a button into the top-right topbar area (next to avatar/search).
const swTopbarButtons = [];
function SwTopbarButton(label, svgString, onClick) {
  this.label = label;
  this.svgString = svgString;
  this.onClick = onClick;
  this.element = null;
  this._render();
}
SwTopbarButton.prototype._render = function() {
  const btn = document.createElement("button");
  btn.className = "sw-topbar-btn";
  btn.title = this.label;
  btn.setAttribute("aria-label", this.label);
  btn.style.cssText =
    "background:none;border:none;cursor:pointer;color:var(--spice-text,#fff);padding:4px 8px;" +
    "display:flex;align-items:center;height:32px;border-radius:4px;";
  btn.innerHTML = this.svgString;
  btn.addEventListener("click", this.onClick.bind(this, this));
  this.element = btn;
  this._inject();
};
SwTopbarButton.prototype._inject = function() {
  // Try to inject into the topbar widget area
  const topbar = qs('[data-testid="topbar-content-wrapper"], .main-topBar-topbarContentWrapper, [data-testid="global-nav-bar"] > div:last-child');
  if (topbar) {
    const container = qs("#sw-topbar-container") || (() => {
      const c = document.createElement("div");
      c.id = "sw-topbar-container";
      c.style.cssText = "display:flex;align-items:center;gap:4px;margin-right:8px;";
      topbar.insertBefore(c, topbar.firstChild);
      return c;
    })();
    container.appendChild(this.element);
  } else {
    // Retry once the topbar is available
    waitFor(() => qs('[data-testid="topbar-content-wrapper"], .main-topBar-topbarContentWrapper'), 10000)
      .then(() => this._inject());
  }
};

// ---- Spicetify.Playbar.Button / Widget ---------------------------------
// Injects a button into the right side of the playbar (next to volume).
function SwPlaybarButton(label, iconOrSvg, onClick, isActive, isEnabled) {
  this.label = label;
  this.iconOrSvg = iconOrSvg;
  this.onClick = onClick;
  this.active = !!isActive;
  this._registered = false;
  this.element = this._makeElement();
  if (isEnabled !== false) this.register();
}
SwPlaybarButton.prototype._makeElement = function() {
  const btn = document.createElement("button");
  btn.className = "sw-playbar-btn";
  btn.title = this.label;
  btn.setAttribute("aria-label", this.label);
  btn.style.cssText =
    "background:none;border:none;cursor:pointer;color:var(--spice-text,#b3b3b3);padding:4px;" +
    "display:flex;align-items:center;border-radius:4px;";
  // If iconOrSvg looks like SVG markup use it directly; else treat as icon name
  if (this.iconOrSvg && this.iconOrSvg.trim().startsWith("<")) {
    btn.innerHTML = this.iconOrSvg;
  } else {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6"/></svg>';
    btn.title = this.label + (this.iconOrSvg ? " [" + this.iconOrSvg + "]" : "");
  }
  btn.addEventListener("click", () => this.onClick(this));
  return btn;
};
SwPlaybarButton.prototype.register = function() {
  if (this._registered) return;
  this._registered = true;
  const container = swGetPlaybarContainer();
  container.appendChild(this.element);
};
SwPlaybarButton.prototype.deregister = function() {
  if (!this._registered) return;
  this._registered = false;
  if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
};

// Widget is essentially the same as Button for our purposes
function SwPlaybarWidget(label, iconOrSvg, onClick, isActive, isEnabled, register) {
  SwPlaybarButton.call(this, label, iconOrSvg, onClick, isActive, register !== false && isEnabled !== false);
  this.active = !!isActive;
}
SwPlaybarWidget.prototype = Object.create(SwPlaybarButton.prototype);

let swPlaybarContainer = null;
function swGetPlaybarContainer() {
  if (swPlaybarContainer && document.contains(swPlaybarContainer)) return swPlaybarContainer;
  swPlaybarContainer = qs("#sw-playbar-container");
  if (swPlaybarContainer) return swPlaybarContainer;
  swPlaybarContainer = document.createElement("div");
  swPlaybarContainer.id = "sw-playbar-container";
  swPlaybarContainer.style.cssText = "display:flex;align-items:center;gap:4px;";
  // Insert before the volume control in the now-playing bar right section
  const volBar = qs('[data-testid="volume-bar"]') || qs('[data-testid="now-playing-bar-right"]');
  if (volBar && volBar.parentNode) {
    volBar.parentNode.insertBefore(swPlaybarContainer, volBar);
  } else {
    waitFor(() => qs('[data-testid="volume-bar"]'), 15000).then((el) => {
      if (el && el.parentNode) el.parentNode.insertBefore(swPlaybarContainer, el);
    });
  }
  return swPlaybarContainer;
}

// ---- Spicetify.ContextMenu.Item ----------------------------------------
// Intercepts the Spotify context menu (right-click on tracks/albums/etc.)
// and injects custom items into it. The context menu is a <ul> with
// data-testid="context-menu" that Spotify renders as a portal.
const swContextMenuItems = [];
function SwContextMenuItem(name, onClick, shouldAdd, icon) {
  this.name = name;
  this.onClick = onClick;       // fn([uri], [uid], contextUri)
  this.shouldAdd = shouldAdd;   // fn([uri]) → bool
  this.icon = icon || null;
  this._lastUris = null;
}
SwContextMenuItem.prototype.register = function() {
  swContextMenuItems.push(this);
};
SwContextMenuItem.prototype.deregister = function() {
  const i = swContextMenuItems.indexOf(this);
  if (i >= 0) swContextMenuItems.splice(i, 1);
};

// Capture right-click URIs from Spotify's internal row elements
let swContextUris = [];
document.addEventListener("contextmenu", (ev) => {
  // Spotify rows expose their URI via data attribute or aria-label
  const row = ev.target.closest("[data-uri], [aria-rowindex], .main-trackList-trackListRow");
  swContextUris = [];
  if (row) {
    const uri = row.dataset.uri || row.getAttribute("aria-label");
    if (uri && uri.startsWith("spotify:")) swContextUris = [uri];
  }
  // Give Spotify's own menu a tick to render, then inject
  setTimeout(swInjectContextMenu, 80);
}, true);

function swInjectContextMenu() {
  const menu = qs('[data-testid="context-menu"] ul, ul[role="menu"]');
  if (!menu || menu.dataset.swCtxPatched) return;
  menu.dataset.swCtxPatched = "1";
  const uris = swContextUris.length ? swContextUris : ["spotify:track:unknown"];
  swContextMenuItems.forEach((item) => {
    try { if (!item.shouldAdd(uris)) return; } catch(e) { return; }
    const li = document.createElement("li");
    li.setAttribute("role", "presentation");
    const btn = document.createElement("button");
    btn.setAttribute("role", "menuitem");
    btn.style.cssText =
      "width:100%;padding:10px 16px;background:none;border:none;cursor:pointer;" +
      "color:var(--spice-text,#fff);text-align:left;font-size:14px;display:flex;align-items:center;gap:10px;";
    if (item.icon && item.icon.trim().startsWith("<")) {
      const span = document.createElement("span");
      span.innerHTML = item.icon;
      btn.appendChild(span);
    }
    btn.appendChild(document.createTextNode(item.name));
    btn.addEventListener("click", () => {
      try { item.onClick(uris, [], undefined); } catch(e) { console.error("[spicetify-web ctx]", e); }
      // Close the context menu
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    li.appendChild(btn);
    menu.appendChild(li);
  });
}

// ---- Spicetify.PopupModal ----------------------------------------------
const swPopupModal = {
  display({ title, content, isLarge }) {
    // Remove any existing modal
    const existing = qs("#sw-popup-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "sw-popup-modal";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--spice-player,#282828);color:var(--spice-text,#fff);border-radius:8px;" +
      "padding:24px;max-height:80vh;overflow:auto;position:relative;" +
      (isLarge ? "width:min(700px,90vw);" : "width:min(480px,90vw);");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    h2.style.cssText = "margin:0;font-size:18px;font-weight:700;";
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&times;";
    closeBtn.style.cssText =
      "background:none;border:none;color:var(--spice-text,#fff);font-size:24px;cursor:pointer;padding:0 4px;line-height:1;";
    closeBtn.addEventListener("click", () => overlay.remove());
    header.appendChild(h2);
    header.appendChild(closeBtn);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    box.appendChild(header);
    if (content instanceof HTMLElement) {
      box.appendChild(content);
    } else if (typeof content === "string") {
      box.innerHTML += content;
    }

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  },
};

// ---- Spicetify.SVGIcons (minimal subset) --------------------------------
// Spicetify exposes these as raw SVG path strings (not full <svg> elements).
const swSVGIcons = {
  "play": '<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/>',
  "pause": '<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/>',
  "skip-back": '<path d="M13 2.5L5 7.119V3H3v10h2V9.581l8 4.419z"/>',
  "skip-forward": '<path d="M3 13.5L11 8.881V13h2V3h-2v3.619L3 2.5z"/>',
  "shuffle": '<path d="M4.5 6.8l.7-.8H2V4h4.5l1.4 1.6L4.5 6.8zM11.5 4L13 5.5l-1.5 1.5-1-1 .5-.5-.5-.5 1-1zM4.5 9.2l.7.8H2v2h4.5l1.4-1.6L4.5 9.2zM11.5 12l1.5-1.5L11.5 9l-1 1 .5.5-.5.5 1 1zM5.9 8L4.5 6.8l-.7.7L2 8l1.8.5.7.7L5.9 8zm5.6 0l1.5.5-1.5 1.5-1-1 .5-.5-.5-.5 1-1z"/>',
  "repeat": '<path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.81 12h2.44A2.25 2.25 0 0 0 14.5 9.75v-5A2.25 2.25 0 0 0 12.25 2.5h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z"/>',
  "heart": '<path d="M1.69 2A4.582 4.582 0 0 1 8 2.023 4.583 4.583 0 0 1 11.88.817h.002a4.618 4.618 0 0 1 3.782 3.65.085.085 0 0 0 .003.01c.025.127.046.257.061.39.24 2.162-.88 4.1-3.2 6.2l-.024.022-4.412 4.098a.085.085 0 0 1-.057.023.085.085 0 0 1-.059-.024L4.014 11.2C1.764 9.16.45 7.044.45 5.03.45 3.82.908 2.667 1.69 2z"/>',
  "heart-active": '<path fill="currentColor" d="M1.69 2A4.582 4.582 0 0 1 8 2.023 4.583 4.583 0 0 1 11.88.817h.002a4.618 4.618 0 0 1 3.782 3.65.085.085 0 0 0 .003.01c.025.127.046.257.061.39.24 2.162-.88 4.1-3.2 6.2l-.024.022-4.412 4.098a.085.085 0 0 1-.057.023.085.085 0 0 1-.059-.024L4.014 11.2C1.764 9.16.45 7.044.45 5.03.45 3.82.908 2.667 1.69 2z"/>',
  "check": '<path d="M15.53 2.47a.75.75 0 0 1 0 1.06L4.907 14.153a.75.75 0 0 1-1.061 0L.47 11.275a.75.75 0 0 1 1.06-1.06l2.847 2.846L14.47 2.47a.75.75 0 0 1 1.06 0z"/>',
  "x": '<path d="M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06z"/>',
  "artist": '<path d="M9.692 1.01a.76.76 0 0 1 .82.23 9.496 9.496 0 0 1 2.168 6.38 9.495 9.495 0 0 1-2.168 6.37.75.75 0 0 1-.82.23A7.5 7.5 0 0 1 .75 7.5 7.5 7.5 0 0 1 9.692 1.01zM2.84 12.016a6 6 0 0 0 6.764-.278 8 8 0 0 0 1.696-5.238A8 8 0 0 0 9.604 1.26a6 6 0 0 0-6.764 10.756z"/>',
  "album": '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-3 2a3 3 0 1 1 6 0 3 3 0 0 1-6 0z"/>',
  "clock": '<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/><path d="M8 3.25a.75.75 0 0 1 .75.75v3.25H11a.75.75 0 0 1 0 1.5H7.25V4A.75.75 0 0 1 8 3.25z"/>',
  "lyrics": '<path d="M12 3H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1v2.625L8.5 12H12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM4 2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5v3.5l5-3.5H12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4z"/>',
  "projector": '<path d="M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/><path d="M0 8C0 3.582 3.582 0 8 0s8 3.582 8 8-3.582 8-8 8-8-3.582-8-8zm8-6.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5z"/>',
  "enhance": '<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/><path d="M11.75 6.5H8.75V3.5h-1.5v3H4.25v1.5h3v3h1.5v-3h3V6.5z"/>',
  "shuffle": '<path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.018 1.018a.75.75 0 0 0 1.06 1.06L15.98 4.75 13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"/><path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.018-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.937z"/>',
  "playlist-folder": '<path d="M1 3a1 1 0 0 1 1-1h4.78l1.78 1.78A1 1 0 0 0 9.265 4H14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3z"/>',
  "chart-up": '<path d="M15 12H1v-1.5l5-4.5 4 3.632L14.165 4.5 15 5.5V12zM1 2h14v1H1z"/>',
  "chart-down": '<path d="M15 4H1v1.5l5 4.5 4-3.632L14.165 11.5 15 10.5V4zM1 14h14v-1H1z"/>',
};

// ---- Spicetify.URI (minimal subset) ------------------------------------
// Extensions use: URI.fromString, URI.isTrack, URI.isLocalTrack,
// URI.isPlaylistV1OrV2, URI.Type (constants), and uri.type, uri.id/_base62Id
const swURIType = {
  TRACK: "track", LOCAL_TRACK: "local-track",
  ALBUM: "album", ARTIST: "artist",
  PLAYLIST: "playlist", PLAYLIST_V2: "playlist-v2",
  COLLECTION: "collection", FOLDER: "folder",
  SHOW: "show", EPISODE: "episode",
  APPLICATION: "application",
};

function swURIFromString(uriOrUrl) {
  if (!uriOrUrl) return null;
  // Normalise Spotify web URLs to URI form
  let str = uriOrUrl;
  const urlMatch = str.match(/open\.spotify\.com\/(track|album|artist|playlist|show|episode|user\/[^/]+\/playlist)\/([a-zA-Z0-9]+)/);
  if (urlMatch) str = "spotify:" + urlMatch[1].replace(/\/[^/]+\//, ":") + ":" + urlMatch[2];

  const parts = str.split(":");
  if (parts[0] !== "spotify" || parts.length < 3) {
    return { _raw: str, type: swURIType.APPLICATION, id: str, _base62Id: str, toURI: () => str, toURLPath: () => "/" + str };
  }
  const type = (() => {
    switch (parts[1]) {
      case "track": return swURIType.TRACK;
      case "local": return swURIType.LOCAL_TRACK;
      case "album": return swURIType.ALBUM;
      case "artist": return swURIType.ARTIST;
      case "playlist": return parts.length > 3 ? swURIType.PLAYLIST_V2 : swURIType.PLAYLIST;
      case "user": return swURIType.PLAYLIST; // legacy playlist
      case "collection": return swURIType.COLLECTION;
      case "folder": return swURIType.FOLDER;
      case "show": return swURIType.SHOW;
      case "episode": return swURIType.EPISODE;
      default: return swURIType.APPLICATION;
    }
  })();
  const id = parts[parts.length - 1];
  const typePath = { track: "track", album: "album", artist: "artist", playlist: "playlist", show: "show", episode: "episode" }[parts[1]] || parts[1];
  return {
    _raw: str, type, id, _base62Id: id,
    toURI: () => str,
    toURLPath: (absolute) => (absolute ? "" : "") + "/" + typePath + "/" + id,
  };
}

const swURI = {
  Type: swURIType,
  fromString: swURIFromString,
  isTrack: (uri) => typeof uri === "string" && uri.startsWith("spotify:track:"),
  isLocalTrack: (uri) => typeof uri === "string" && uri.startsWith("spotify:local:"),
  isEpisode: (uri) => typeof uri === "string" && uri.startsWith("spotify:episode:"),
  isPlaylistV1OrV2: (uri) => typeof uri === "string" && uri.startsWith("spotify:playlist:"),
};

// ---- Spicetify.Keyboard ------------------------------------------------
const swKeyboard = {
  KEYS: {
    ESCAPE: "Escape", ENTER: "Enter", BACKSPACE: "Backspace",
    TAB: "Tab", SPACE: " ", SHIFT: "Shift", CTRL: "Control", ALT: "Alt",
    LEFT: "ArrowLeft", RIGHT: "ArrowRight", UP: "ArrowUp", DOWN: "ArrowDown",
    PAGE_UP: "PageUp", PAGE_DOWN: "PageDown", HOME: "Home", END: "End",
    F1:"F1",F2:"F2",F3:"F3",F4:"F4",F5:"F5",F6:"F6",
    F7:"F7",F8:"F8",F9:"F9",F10:"F10",F11:"F11",F12:"F12",
  },
};

// ---- Spicetify.Mousetrap -----------------------------------------------
// Use the real Mousetrap library if it's on the page; otherwise a thin shim.
const swMousetrap = (function() {
  if (typeof Mousetrap !== "undefined") {
    const mt = new Mousetrap();
    mt.bind = Mousetrap.bind.bind(Mousetrap);
    mt.unbind = Mousetrap.unbind.bind(Mousetrap);
    return mt;
  }
  // Minimal fallback
  const _binds = {};
  function _normalise(combo) { return combo.toLowerCase().replace(/\s+/g, " ").trim(); }
  document.addEventListener("keydown", (e) => {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.shiftKey) parts.push("shift");
    if (e.altKey) parts.push("alt");
    const k = e.key.toLowerCase();
    if (!["control","shift","alt","meta"].includes(k)) parts.push(k);
    const combo = parts.join("+");
    (_binds[combo] || []).forEach((cb) => { try { cb(e); } catch(ex) {} });
  });
  return {
    bind(combos, cb) {
      (Array.isArray(combos) ? combos : [combos]).forEach((c) => {
        const key = _normalise(c);
        if (!_binds[key]) _binds[key] = [];
        _binds[key].push(cb);
      });
    },
    unbind(combos) {
      (Array.isArray(combos) ? combos : [combos]).forEach((c) => { delete _binds[_normalise(c)]; });
    },
    stopCallback: () => false,
  };
})();

// ---- Events.webpackLoaded: fires once the app shell exists --------------
const swWebpackLoaded = {
  _cbs: [],
  on(cb) { this._cbs.push(cb); },
};
waitFor(() => qs('[data-testid="now-playing-widget"]'), 20000).then(() => {
  swWatchPlayback();
  swWebpackLoaded._cbs.forEach((cb) => { try { cb(); } catch (e) { console.error("[spicetify-web]", e); } });
});

// ---- assemble the global -----------------------------------------------
window.Spicetify = window.Spicetify || {};
Object.assign(window.Spicetify, {
  LocalStorage: swLocalStorage,
  showNotification: swShowNotification,
  Player: swPlayer,
  Menu: { Item: SwMenuItem },
  Topbar: { Button: SwTopbarButton },
  Playbar: { Button: SwPlaybarButton, Widget: SwPlaybarWidget },
  ContextMenu: { Item: SwContextMenuItem },
  PopupModal: swPopupModal,
  SVGIcons: swSVGIcons,
  URI: swURI,
  Keyboard: swKeyboard,
  Mousetrap: swMousetrap,
  Events: { webpackLoaded: swWebpackLoaded },
  _dom: { qs, qs_all: qsa, waitFor },
});

// ---- theme/theme-dom-patch.js ----
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
  ['[data-testid="now-playing-widget"]',                   "main-nowPlayingBar-nowPlayingBar"],
  ['[data-testid="now-playing-bar"]',                      "main-nowPlayingBar-nowPlayingBar"],
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
  ['nav[aria-label="Main"]',                               "Root__nav-bar main-navBar-navBar"],
  ['[data-testid="global-nav-bar"]',                       "Root__globalNav main-globalNav"],
  ['[data-testid="left-sidebar"]',                         "Root__nav-bar"],
  ['[aria-label="Your Library"]',                          "main-yourLibrary-library"],

  // Library nav links / items
  ['[data-testid="rootlist-item"]',                        "main-rootlist-rootlistItem"],
  ['[data-testid="rootlist-item"] a',                      "main-rootlist-rootlistItemLink"],
  ['[data-testid="rootlist-item"] img',                    "main-image-image main-rootlist-rootlistItemImage"],

  // ── Top bar ──────────────────────────────────────────────────────────────
  ['[data-testid="topbar-content-wrapper"]',               "main-topBar-topbarContentWrapper"],
  ['[data-testid="global-nav-bar"] header',                "main-topBar-header"],
  ['[data-testid="topbar-forward-button"]',                "main-topBar-forward"],
  ['[data-testid="topbar-back-button"]',                   "main-topBar-back"],

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

Spicetify.Events.webpackLoaded.on(() => {
  swPatchBody();
  swPatchOnce(document);

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

// ---- ext/ext-autoskip-explicit.js ----
// ---- ext: auto-skip explicit tracks (ported from spicetify/cli autoSkipExplicit.js) ----
// Original reads Spicetify.Player.data.item.metadata.is_explicit, which on
// desktop comes from Spotify's internal state. Our shim derives the same
// field from the explicit "E" badge next to the track title.
(async function AutoSkipExplicitWeb() {
  await new Promise((res) => Spicetify.Events.webpackLoaded.on(res));

  let isEnabled = Spicetify.LocalStorage.get("AutoSkipExplicit") === "1";

  new Spicetify.Menu.Item("Skip explicit tracks", isEnabled, (self) => {
    isEnabled = !isEnabled;
    Spicetify.LocalStorage.set("AutoSkipExplicit", isEnabled ? "1" : "0");
    self.setState(isEnabled);
    Spicetify.showNotification("Skip explicit tracks: " + (isEnabled ? "on" : "off"));
  }).register();

  Spicetify.Player.addEventListener("songchange", () => {
    if (!isEnabled) return;
    const data = Spicetify.Player.data;
    if (!data) return;
    if (data.item.metadata.is_explicit === "true") {
      Spicetify.showNotification("Skipping explicit: " + data.item.metadata.title);
      Spicetify.Player.next();
    }
  });
})();

// ---- ext/ext-autoskip-video.js ----
// ---- ext: auto-skip video tracks (ported from spicetify/cli autoSkipVideo.js) ----
// On the web player, video media type isn't directly exposed, but Spotify
// sometimes loads canvas/video items. We detect them by looking for a
// <video> element in the player area (Spotify Canvas), not the album art img.
// Falls back to the metadata field our shim sets ("audio" by default).
(function AutoSkipVideoWeb() {
  Spicetify.Player.addEventListener("songchange", () => {
    const data = Spicetify.Player.data;
    if (!data) return;
    const meta = data.item.metadata;
    // Check shim-reported media type and also look for an active Canvas video
    const hasCanvasVideo = !!document.querySelector(
      '[data-testid="canvas-container"] video, .Root__main-view video[autoplay]'
    );
    const isVideo = meta["media.type"] === "video" || hasCanvasVideo;
    if (isVideo && meta.is_advertisement !== "true") {
      Spicetify.Player.next();
    }
  });
})();

// ---- ext/ext-trashbin.js ----
// ---- ext: trashbin (ported from spicetify/cli trashbin.js) ----
// Throw songs / artists to trashbin and never hear them again.
// Persists the trashlist in localStorage via Spicetify.LocalStorage.
// Uses Playbar.Widget + Menu.Item + ContextMenu.Item — all shimmed.
(function TrashBin() {
  if (!Spicetify.Player.data || !Spicetify.LocalStorage) {
    setTimeout(TrashBin, 1000);
    return;
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function initValue(key, def) {
    try { const v = JSON.parse(Spicetify.LocalStorage.get(key)); return v ?? def; }
    catch { return def; }
  }
  function putDataLocal() {
    Spicetify.LocalStorage.set("TrashSongList",   JSON.stringify(trashSongList));
    Spicetify.LocalStorage.set("TrashArtistList", JSON.stringify(trashArtistList));
  }

  // ── state ─────────────────────────────────────────────────────────────────
  let trashSongList   = initValue("TrashSongList",   {});
  let trashArtistList = initValue("TrashArtistList", {});
  let trashbinStatus  = initValue("trashbin-enabled", true);
  let enableWidget    = initValue("TrashbinWidgetIcon", true);
  let userHitBack     = false;

  const THROW_TEXT   = "Place in Trashbin";
  const UNTHROW_TEXT = "Remove from Trashbin";

  const trashbinIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentcolor">' +
    '<path d="M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3h4.75zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583zM2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z"/>' +
    '</svg>';

  // ── settings UI ──────────────────────────────────────────────────────────
  function makeSwitch(label, currentVal, onChange) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 0;";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "color:var(--spice-text,#fff);";
    const btn = document.createElement("button");
    btn.style.cssText =
      "border:none;border-radius:50%;background:rgba(0,0,0,.7);color:var(--spice-text,#fff);" +
      "cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;";
    btn.innerHTML = '<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">' + Spicetify.SVGIcons.check + '</svg>';
    if (!currentVal) btn.style.color = "rgba(255,255,255,.3)";
    btn.addEventListener("click", () => {
      const next = btn.style.color === "rgba(255, 255, 255, 0.3)";
      btn.style.color = next ? "" : "rgba(255,255,255,.3)";
      onChange(next);
    });
    row.appendChild(lbl); row.appendChild(btn);
    return row;
  }

  function makeResetBtn(label, desc, onClick) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 0;";
    const d = document.createElement("span");
    d.textContent = desc;
    d.style.cssText = "color:var(--spice-subtext,#aaa);font-size:13px;flex:1;padding-right:12px;";
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
      "font-weight:700;background:transparent;border-radius:500px;border:1px solid #727272;" +
      "color:var(--spice-text,#fff);padding:0 15px;min-height:32px;cursor:pointer;white-space:nowrap;";
    btn.addEventListener("click", onClick);
    row.appendChild(d); row.appendChild(btn);
    return row;
  }

  function openSettings() {
    const content = document.createElement("div");

    const h2opts = document.createElement("h2");
    h2opts.textContent = "Options";
    h2opts.style.cssText = "margin:0 0 8px;font-size:16px;";
    content.appendChild(h2opts);

    content.appendChild(makeSwitch("Enabled", trashbinStatus, (state) => {
      trashbinStatus = state;
      Spicetify.LocalStorage.set("trashbin-enabled", state);
      refreshEventListeners(state);
    }));
    content.appendChild(makeSwitch("Show Widget Icon", enableWidget, (state) => {
      enableWidget = state;
      Spicetify.LocalStorage.set("TrashbinWidgetIcon", state);
      state && trashbinStatus ? widget.register() : widget.deregister();
    }));

    const h2ls = document.createElement("h2");
    h2ls.textContent = "Local Storage";
    h2ls.style.cssText = "margin:16px 0 8px;font-size:16px;";
    content.appendChild(h2ls);

    content.appendChild(makeResetBtn("Copy", "Copy all items in trashbin to clipboard.", () => {
      const data = JSON.stringify({ songs: trashSongList, artists: trashArtistList });
      navigator.clipboard?.writeText(data)
        .then(() => Spicetify.showNotification("Copied to clipboard"))
        .catch(() => Spicetify.showNotification("Clipboard unavailable", true));
    }));
    content.appendChild(makeResetBtn("Clear", "Clear all items from trashbin (cannot be reverted).", () => {
      trashSongList = {}; trashArtistList = {};
      setWidgetState(false);
      putDataLocal();
      Spicetify.showNotification("Trashbin cleared!");
    }));

    Spicetify.PopupModal.display({ title: "Trashbin Settings", content });
  }

  // ── menu item (settings) ─────────────────────────────────────────────────
  new Spicetify.Menu.Item("Trashbin", false, () => openSettings(), trashbinIcon).register();

  // ── playbar widget ────────────────────────────────────────────────────────
  const widget = new Spicetify.Playbar.Widget(
    THROW_TEXT, trashbinIcon,
    (self) => {
      const data = Spicetify.Player.data;
      if (!data) return;
      const uri = data.item.uri;
      if (!trashSongList[uri]) {
        trashSongList[uri] = true;
        if (uri === data.item.uri) Spicetify.Player.next();
        Spicetify.showNotification("Song added to trashbin");
      } else {
        delete trashSongList[uri];
        setWidgetState(false);
        Spicetify.showNotification("Song removed from trashbin");
      }
      putDataLocal();
    },
    false, false, enableWidget
  );

  // ── state helpers ─────────────────────────────────────────────────────────
  function setWidgetState(state, hidden) {
    if (hidden) { widget.deregister(); return; }
    enableWidget && widget.register();
    widget.active = !!state;
    widget.element.title = state ? UNTHROW_TEXT : THROW_TEXT;
    widget.element.setAttribute("aria-label", widget.element.title);
  }

  function shouldSkipCurrentTrack(uri) {
    const d = Spicetify.Player.data;
    return d && d.item.uri === uri;
  }

  function watchChange() {
    const data = Spicetify.Player.data;
    if (!data) return;
    const uri = data.item.uri;
    const isBanned = !!trashSongList[uri];
    setWidgetState(isBanned);
    if (userHitBack) { userHitBack = false; return; }
    if (isBanned) { Spicetify.Player.next(); return; }
    // Check artist-level ban
    let idx = 0;
    let artistUri = data.item.metadata.artist_uri;
    while (artistUri) {
      if (trashArtistList[artistUri]) { Spicetify.Player.next(); return; }
      idx++;
      artistUri = data.item.metadata["artist_uri:" + idx];
    }
  }

  function refreshEventListeners(state) {
    trashbinStatus = state;
    if (state) {
      Spicetify.Player.addEventListener("songchange", watchChange);
      enableWidget && widget.register();
      watchChange();
    } else {
      Spicetify.Player.removeEventListener("songchange", watchChange);
      widget.deregister();
    }
  }

  // ── context menu ──────────────────────────────────────────────────────────
  function toggleThrow(uris) {
    const uri = uris[0];
    const list = Spicetify.URI.isTrack(uri) ? trashSongList : trashArtistList;
    if (!list[uri]) {
      list[uri] = true;
      if (shouldSkipCurrentTrack(uri)) Spicetify.Player.next();
      Spicetify.showNotification(
        Spicetify.URI.isTrack(uri) ? "Song added to trashbin" : "Artist added to trashbin"
      );
    } else {
      delete list[uri];
      Spicetify.showNotification(
        Spicetify.URI.isTrack(uri) ? "Song removed from trashbin" : "Artist removed from trashbin"
      );
    }
    putDataLocal();
  }

  function shouldAddContextMenu(uris) {
    if (uris.length > 1 || !trashbinStatus) return false;
    const uri = uris[0];
    return Spicetify.URI.isTrack(uri) ||
      (Spicetify.URI.fromString(uri) && Spicetify.URI.fromString(uri).type === Spicetify.URI.Type.ARTIST);
  }

  const cntxMenu = new Spicetify.ContextMenu.Item(THROW_TEXT, toggleThrow, shouldAddContextMenu, trashbinIcon);
  cntxMenu.register();

  // ── init ─────────────────────────────────────────────────────────────────
  putDataLocal();
  refreshEventListeners(trashbinStatus);
  const d = Spicetify.Player.data;
  if (d) setWidgetState(!!trashSongList[d.item.uri]);
})();

// ---- ext/ext-loopyloop.js ----
// ---- ext: loopy loop (ported from spicetify/cli loopyLoop.js) ----
// Right-click the progress bar to set song start/end markers and skip zones.
// All points persist per-song across sessions via LocalStorage.
// Works with the web player because 03-theme-dom-patch stamps
// .playback-bar and .playback-progressbar-container onto the correct elements.
(function LoopyLoop() {
  // Wait for the playback bar to be present (class stamped by 03-theme-dom-patch)
  const playbackBar = document.querySelector(".playback-bar");
  if (!playbackBar || !Spicetify.Player) {
    setTimeout(LoopyLoop, 200);
    return;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function getBar() {
    return document.querySelector(".playback-progressbar-container input[type='range']")
      ?.closest("label")?.nextElementSibling ?? null;
  }
  function getProgressContainer() {
    return document.querySelector(".playback-progressbar-container") ?? null;
  }

  // ── styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
#loopy-loop-start, #loopy-loop-end {
  position:absolute;font-weight:bolder;font-size:15px;top:-7px;
  cursor:context-menu;z-index:10;padding:2px 4px;color:var(--spice-text,#fff);
}
.loopy-skip-marker {
  position:absolute;font-weight:bolder;font-size:15px;top:-7px;
  color:#e74c3c;cursor:context-menu;z-index:20;padding:2px 6px;
}
#loopy-context-menu, #loopy-move-submenu { position:fixed;z-index:2147483647; }
`;
  document.head.appendChild(style);

  // ── markers ────────────────────────────────────────────────────────────────
  const startMark = document.createElement("div");
  startMark.id = "loopy-loop-start"; startMark.innerText = "["; startMark.hidden = true;
  const endMark = document.createElement("div");
  endMark.id = "loopy-loop-end"; endMark.innerText = "]"; endMark.hidden = true;

  const bar0 = getBar();
  if (bar0) bar0.append(startMark, endMark);

  // ── per-song state ─────────────────────────────────────────────────────────
  let start = null, end = null, skipZones = [], pendingSkipStart = null;
  let mouseOnBarPercent = 0, lastSkipSeek = 0, lastSkippedZoneIdx = -1;
  let lastNextCall = 0, lastEndLoopSeek = 0, seekStartPendingUri = null;
  let lastStartEnforce = 0, prevProgressPercent = -1, prevPressedAt = 0;
  let navigatingBack = false, activeMarkerType = null, activeZoneIndex = -1;

  function drawOnBar() {
    const b = getBar();
    if (b && startMark.parentElement !== b) b.append(startMark, endMark);
    startMark.hidden = start === null;
    endMark.hidden   = end   === null;
    if (start !== null) startMark.style.left = (start * 100) + "%";
    if (end   !== null) endMark.style.left   = (end   * 100) + "%";
  }

  function drawSkipMarkers() {
    const b = getBar() ?? bar0;
    if (!b) return;
    b.querySelectorAll(".loopy-skip-marker").forEach((el) => el.remove());
    skipZones.forEach((zone, idx) => {
      const s = document.createElement("div");
      s.className = "loopy-skip-marker"; s.innerText = "{";
      s.style.left = (zone.start * 100) + "%";
      s.dataset.zoneIndex = String(idx); s.dataset.zoneSide = "start";
      const e = document.createElement("div");
      e.className = "loopy-skip-marker"; e.innerText = "}";
      e.style.left = (zone.end * 100) + "%";
      e.dataset.zoneIndex = String(idx); e.dataset.zoneSide = "end";
      b.append(e, s);
    });
    if (pendingSkipStart !== null) {
      const p = document.createElement("div");
      p.className = "loopy-skip-marker"; p.innerText = "{";
      p.style.left = (pendingSkipStart * 100) + "%"; p.style.opacity = "0.4";
      b.append(p);
    }
  }

  function saveState() {
    const uri = Spicetify.Player.data?.item?.uri;
    if (!uri) return;
    Spicetify.LocalStorage.set("loopyLoop:" + uri, JSON.stringify({ start, end, skipZones }));
  }

  function loadState() {
    const uri = Spicetify.Player.data?.item?.uri;
    start = null; end = null; skipZones = []; pendingSkipStart = null;
    if (!uri) return;
    try {
      const saved = Spicetify.LocalStorage.get("loopyLoop:" + uri);
      if (saved) {
        const d = JSON.parse(saved);
        start = d.start ?? null; end = d.end ?? null;
        skipZones = Array.isArray(d.skipZones) ? d.skipZones : [];
      }
    } catch(_) {}
  }

  // ── onprogress: loop + skip zone enforcement ───────────────────────────────
  Spicetify.Player.addEventListener("onprogress", (event) => {
    const ts = event?.timeStamp ?? performance.now();
    const percent = Spicetify.Player.getProgressPercent();

    // Repeat-mode restart: song restarted from 0 after hitting ], seek to [
    if (seekStartPendingUri !== null && percent < 0.05) {
      const cur = Spicetify.Player.data?.item?.uri;
      if (cur === seekStartPendingUri && start !== null) {
        seekStartPendingUri = null;
        Spicetify.Player.seek(start * Spicetify.Player.getDuration());
        return;
      }
      seekStartPendingUri = null;
    }

    // Detect prev-button press: jump to ~0 from past Spotify's 3-second threshold
    const durationMs = Spicetify.Player.getDuration() || 0;
    const threeSecFrac = durationMs > 0 ? 3000 / durationMs : 0.02;
    const nearZeroFrac = durationMs > 0 ? 1500 / durationMs : 0.01;
    if (prevProgressPercent > threeSecFrac && percent < nearZeroFrac) {
      if (prevPressedAt > 0 && ts - prevPressedAt < 1500) {
        prevPressedAt = 0; prevProgressPercent = percent;
        navigatingBack = true;
        setTimeout(() => { navigatingBack = false; }, 2000);
        Spicetify.Player.back(); return;
      } else {
        prevPressedAt = ts; prevProgressPercent = percent;
        if (start !== null) Spicetify.Player.seek(start * durationMs);
        return;
      }
    }
    prevProgressPercent = percent;

    // Song start enforcement
    if (start !== null && percent < start) {
      if (navigatingBack) return;
      if (ts - lastStartEnforce > 500) {
        lastStartEnforce = ts;
        Spicetify.Player.seek(start * durationMs);
      }
      return;
    }

    // Song end enforcement
    if (end !== null && percent >= end) {
      if (Spicetify.Player.getRepeat() === 2) {
        if (ts - lastEndLoopSeek > 500) {
          lastEndLoopSeek = ts;
          Spicetify.Player.seek((start ?? 0) * durationMs);
        }
      } else if (ts - lastNextCall > 2000) {
        lastNextCall = ts;
        seekStartPendingUri = Spicetify.Player.data?.item?.uri ?? null;
        Spicetify.Player.next();
      }
      return;
    }

    // Skip zones
    if (skipZones.length > 0) {
      let inZone = false;
      for (let i = 0; i < skipZones.length; i++) {
        const zone = skipZones[i];
        if (percent >= zone.start && percent < zone.end) {
          inZone = true;
          if (i !== lastSkippedZoneIdx || ts - lastSkipSeek > 500) {
            lastSkipSeek = ts; lastSkippedZoneIdx = i;
            Spicetify.Player.seek(zone.end * durationMs);
          }
          break;
        }
      }
      if (!inZone) lastSkippedZoneIdx = -1;
    }
  });

  Spicetify.Player.addEventListener("songchange", () => {
    navigatingBack = false;
    if (Spicetify.Player.data?.item?.uri !== seekStartPendingUri) seekStartPendingUri = null;
    loadState(); drawOnBar(); drawSkipMarkers();
    prevProgressPercent = -1; prevPressedAt = 0; lastStartEnforce = 0;
    lastNextCall = 0; lastEndLoopSeek = 0; lastSkipSeek = 0; lastSkippedZoneIdx = -1;
  });

  // ── context menu ────────────────────────────────────────────────────────────
  function openMenu(menu, x, y) {
    menu.style.left = "-9999px"; menu.style.top = "0";
    menu.hidden = false;
    const { height, width } = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth  - width  - 4) + "px";
    menu.style.top  = Math.max(0, y - height)                       + "px";
  }

  function createMenuItem(title, callback) {
    const li = document.createElement("li"); li.setAttribute("role", "menuitem");
    const btn = document.createElement("button");
    btn.className = "main-contextMenu-menuItemButton";
    btn.style.cssText = "width:100%;padding:10px 16px;background:none;border:none;cursor:pointer;color:var(--spice-text,#fff);text-align:left;font-size:14px;";
    btn.textContent = title;
    btn.onclick = (e) => { e.stopPropagation(); contextMenu.hidden = true; moveSubmenu.hidden = true; callback?.(); };
    li.appendChild(btn); return li;
  }

  // Move submenu
  const moveSubmenu = document.createElement("div");
  moveSubmenu.id = "loopy-move-submenu";
  moveSubmenu.innerHTML = '<ul tabindex="0" class="main-contextMenu-menu" style="background:var(--spice-player,#282828);border-radius:4px;padding:4px 0;list-style:none;min-width:100px;"></ul>';
  moveSubmenu.hidden = true;
  document.body.append(moveSubmenu);

  function applyMoveAdjustment(deltaSeconds) {
    const dur = Spicetify.Player.getDuration();
    if (!dur) return;
    const delta = (deltaSeconds * 1000) / dur;
    if (activeMarkerType === "start")     { start = Math.max(0, Math.min(end ?? 1, start + delta)); drawOnBar(); }
    else if (activeMarkerType === "end")  { end   = Math.max(start ?? 0, Math.min(1, end + delta)); drawOnBar(); }
    else if (activeMarkerType === "zoneStart" && activeZoneIndex >= 0) {
      skipZones[activeZoneIndex].start = Math.max(0, Math.min(skipZones[activeZoneIndex].end - 1e-6, skipZones[activeZoneIndex].start + delta));
      drawSkipMarkers();
    } else if (activeMarkerType === "zoneEnd" && activeZoneIndex >= 0) {
      skipZones[activeZoneIndex].end = Math.max(skipZones[activeZoneIndex].start + 1e-6, Math.min(1, skipZones[activeZoneIndex].end + delta));
      drawSkipMarkers();
    }
    saveState();
  }

  [-0.5, -0.1, -0.01, 0.01, 0.1, 0.5].forEach((delta) => {
    const li = document.createElement("li"); li.setAttribute("role", "menuitem");
    const btn = document.createElement("button");
    btn.style.cssText = "width:100%;padding:6px 16px;background:none;border:none;cursor:pointer;color:var(--spice-text,#fff);text-align:left;font-size:13px;";
    btn.textContent = (delta > 0 ? "+" : "") + delta + "s";
    btn.onclick = (e) => { e.stopPropagation(); applyMoveAdjustment(delta); };
    li.appendChild(btn); moveSubmenu.firstElementChild.appendChild(li);
  });

  // Dynamic section of context menu
  function setupActiveMarker(type, zIdx) {
    activeMarkerType = type; activeZoneIndex = zIdx ?? -1;
    const hasMarker   = type !== null;
    const isSpecific  = hasMarker && type !== "zone";
    divider2.hidden      = !hasMarker;
    moveBtnItem.hidden   = !isSpecific;
    removeActiveBtn.hidden = !hasMarker;
    const rb = removeActiveBtn.querySelector("button");
    rb.textContent = type === "start" ? "Remove song start" : type === "end" ? "Remove song end" : "Remove section";
    rb.onclick = (e) => {
      e.stopPropagation();
      if (type === "start") { start = null; drawOnBar(); }
      else if (type === "end") { end = null; drawOnBar(); }
      else if (activeZoneIndex >= 0) { skipZones.splice(activeZoneIndex, 1); drawSkipMarkers(); activeZoneIndex = -1; }
      saveState(); contextMenu.hidden = true; moveSubmenu.hidden = true;
    };
  }

  // Build the context menu
  const startBtn    = createMenuItem("Set song start", () => {
    if (end !== null && mouseOnBarPercent >= end) { Spicetify.showNotification("Song start must be before song end"); return; }
    start = mouseOnBarPercent; drawOnBar(); saveState();
  });
  const endBtn      = createMenuItem("Set song end", () => {
    if (start !== null && mouseOnBarPercent <= start) { Spicetify.showNotification("Song end must be after song start"); return; }
    end = mouseOnBarPercent; drawOnBar(); saveState();
  });
  const resetBtn    = createMenuItem("Reset song start/end", () => { start = null; end = null; drawOnBar(); saveState(); });
  const divider1    = document.createElement("li");
  divider1.style.cssText = "border-top:1px solid rgba(255,255,255,.2);margin:4px 0;list-style:none;";
  const skipStartBtn = createMenuItem("Set section skip start", () => {
    pendingSkipStart = (pendingSkipStart !== null) ? null : mouseOnBarPercent; drawSkipMarkers();
  });
  const skipEndBtn   = createMenuItem("Set section skip end", () => {
    if (pendingSkipStart === null) { Spicetify.showNotification("No section skip start selected!"); return; }
    const s = Math.min(pendingSkipStart, mouseOnBarPercent);
    const e = Math.max(pendingSkipStart, mouseOnBarPercent);
    if (e > s) {
      if (skipZones.length < 10) { skipZones.push({ start: s, end: e }); saveState(); drawSkipMarkers(); }
      else Spicetify.showNotification("Maximum 10 skip zones reached");
    }
    pendingSkipStart = null;
  });
  const clearSkipsBtn = createMenuItem("Clear section skips", () => { skipZones = []; pendingSkipStart = null; saveState(); drawSkipMarkers(); });

  const divider2 = document.createElement("li");
  divider2.style.cssText = "border-top:1px solid rgba(255,255,255,.2);margin:4px 0;list-style:none;"; divider2.hidden = true;

  const moveBtnItem = document.createElement("li"); moveBtnItem.setAttribute("role", "menuitem");
  const moveBtnEl = document.createElement("button");
  moveBtnEl.style.cssText = "width:100%;padding:10px 16px;background:none;border:none;cursor:pointer;color:var(--spice-text,#fff);text-align:left;font-size:14px;";
  moveBtnEl.textContent = "Move \u25B6"; moveBtnItem.appendChild(moveBtnEl); moveBtnItem.hidden = true;

  const removeActiveBtn = document.createElement("li"); removeActiveBtn.setAttribute("role", "menuitem");
  const removeActiveBtnEl = document.createElement("button");
  removeActiveBtnEl.style.cssText = "width:100%;padding:10px 16px;background:none;border:none;cursor:pointer;color:var(--spice-text,#fff);text-align:left;font-size:14px;";
  removeActiveBtnEl.textContent = "Remove section"; removeActiveBtn.appendChild(removeActiveBtnEl); removeActiveBtn.hidden = true;

  const contextMenu = document.createElement("div");
  contextMenu.id = "loopy-context-menu";
  const ul = document.createElement("ul");
  ul.style.cssText = "background:var(--spice-player,#282828);border-radius:4px;padding:4px 0;list-style:none;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,.5);";
  ul.setAttribute("tabindex", "0");
  ul.append(startBtn, endBtn, resetBtn, divider1, skipStartBtn, skipEndBtn, clearSkipsBtn, divider2, moveBtnItem, removeActiveBtn);
  contextMenu.appendChild(ul);
  document.body.append(contextMenu); contextMenu.hidden = true;

  // Move submenu show/hide
  let moveHideTimer = null;
  const cancelMoveHide = () => { if (moveHideTimer) { clearTimeout(moveHideTimer); moveHideTimer = null; } };
  const scheduleMoveHide = () => { cancelMoveHide(); moveHideTimer = setTimeout(() => { moveSubmenu.hidden = true; }, 150); };
  function showMoveSubmenu() {
    const rect = moveBtnEl.getBoundingClientRect();
    moveSubmenu.style.left = "-9999px"; moveSubmenu.style.top = "0"; moveSubmenu.hidden = false;
    const { height, width } = moveSubmenu.getBoundingClientRect();
    moveSubmenu.style.left = Math.min(rect.right + 2, window.innerWidth - width - 4) + "px";
    moveSubmenu.style.top  = Math.max(0, Math.min(rect.top, window.innerHeight - height - 4)) + "px";
  }

  moveBtnEl.onclick = (e) => { e.stopPropagation(); cancelMoveHide(); showMoveSubmenu(); };
  moveBtnItem.addEventListener("mouseenter", () => { cancelMoveHide(); showMoveSubmenu(); });
  moveBtnItem.addEventListener("mouseleave", scheduleMoveHide);
  moveSubmenu.addEventListener("mouseenter", cancelMoveHide);
  moveSubmenu.addEventListener("mouseleave", scheduleMoveHide);

  window.addEventListener("click", (e) => {
    if (!contextMenu.contains(e.target) && !moveSubmenu.contains(e.target)) {
      contextMenu.hidden = true; moveSubmenu.hidden = true;
    }
  });

  // ── capture-phase contextmenu handler ─────────────────────────────────────
  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (target.id === "loopy-loop-start") {
      event.preventDefault(); event.stopPropagation();
      mouseOnBarPercent = start ?? 0;
      setupActiveMarker("start"); openMenu(contextMenu, event.clientX, event.clientY); return;
    }
    if (target.id === "loopy-loop-end") {
      event.preventDefault(); event.stopPropagation();
      mouseOnBarPercent = end ?? 1;
      setupActiveMarker("end"); openMenu(contextMenu, event.clientX, event.clientY); return;
    }
    if (target.classList?.contains("loopy-skip-marker") && target.dataset.zoneIndex != null) {
      event.preventDefault(); event.stopPropagation();
      const zIdx = parseInt(target.dataset.zoneIndex, 10);
      if (!Number.isFinite(zIdx) || zIdx < 0 || zIdx >= skipZones.length) return;
      const side = target.dataset.zoneSide === "end" ? "zoneEnd" : "zoneStart";
      const b = getBar();
      if (b) { const { x, width } = b.getBoundingClientRect(); mouseOnBarPercent = Math.max(0, Math.min(1, (event.clientX - x) / width)); }
      setupActiveMarker(side, zIdx); openMenu(contextMenu, event.clientX, event.clientY); return;
    }
    const pc = getProgressContainer();
    if (!pc?.contains(target)) return;
    event.preventDefault(); event.stopPropagation();
    const b = pc.querySelector('input[type="range"]')?.closest("label")?.nextElementSibling;
    if (!b) return;
    const { x, width } = b.getBoundingClientRect();
    mouseOnBarPercent = Math.max(0, Math.min(1, (event.clientX - x) / width));
    const hitZone = skipZones.findIndex((z) => mouseOnBarPercent > z.start && mouseOnBarPercent < z.end);
    setupActiveMarker(hitZone >= 0 ? "zone" : null, hitZone);
    // Update the start-skip-btn label
    skipStartBtn.querySelector("button").textContent = pendingSkipStart !== null ? "Cancel skip start" : "Set section skip start";
    openMenu(contextMenu, event.clientX, event.clientY);
  }, true);

  // ── toolbar button ─────────────────────────────────────────────────────────
  try {
    const markerIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" height="16" width="16"><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="3" y="3" width="2" height="10" rx="1"/><rect x="11" y="3" width="2" height="10" rx="1"/><rect x="6" y="5" width="1.5" height="6" rx="0.75"/><rect x="8.5" y="5" width="1.5" height="6" rx="0.75"/></svg>`;
    const toolbarBtn = new Spicetify.Playbar.Button("Loopy Loop", markerIcon, () => {
      mouseOnBarPercent = Spicetify.Player.getProgressPercent();
      setupActiveMarker(null, -1);
      skipStartBtn.querySelector("button").textContent = pendingSkipStart !== null ? "Cancel skip start" : "Set section skip start";
      const rect = toolbarBtn.element.getBoundingClientRect();
      openMenu(contextMenu, rect.left, rect.top);
    });
    toolbarBtn.element.addEventListener("click", (e) => e.stopPropagation());
  } catch(_) {}

  // ── load initial state ────────────────────────────────────────────────────
  function tryLoadInitialState(attemptsLeft) {
    if (Spicetify.Player.data?.item?.uri) {
      loadState(); drawOnBar(); drawSkipMarkers();
    } else if (attemptsLeft > 0) {
      setTimeout(() => tryLoadInitialState(attemptsLeft - 1), 200);
    }
  }
  tryLoadInitialState(10);
})();

// ---- ext/ext-keyboard-shortcut.js ----
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

// ---- ext/ext-adblock.js ----
// ---- ext: adblock (network-level, ported from spicetify community adblock.js) ----
// Desktop spicetify's adblock mostly just CSS-hides ad banner nodes because on
// desktop Spotify already skips ad *audio* requests for logged-in accounts.
// On the web player, ad requests are real HTTP calls the page makes itself —
// Spotify's own ad endpoints (ad-logic/ad-provider on *.spclient.spotify.com,
// gabo-receiver-service, adeng-pa/adeng-secure) plus third-party ad tech
// (Google Publisher Tag / doubleclick, googlesyndication). This module blocks
// those at the network layer -- fetch/XHR requests never go out, and any
// <script>/<iframe> tag pointed at one of these hosts gets pulled before it
// loads -- rather than just hiding whatever banner DOM they'd have produced.
(function AdblockWeb() {
  const AD_HOST_RE = new RegExp(
    [
      "doubleclick\\.net",
      "googlesyndication\\.com",
      "googletagservices\\.com",
      "google-analytics\\.com/g/collect.*ad",
      "adservice\\.google\\.",
      "pagead2\\.googlesyndication\\.com",
      "pubmatic\\.com",
      "gabo-receiver-service\\.spotify\\.com",
      "adeng-pa\\.spotify\\.com",
      "adeng-secure\\.spotify\\.com",
      "spclient\\.wg\\.spotify\\.com/ad-",
      "spclient\\.wg\\.spotify\\.com.*/ads?/",
      "-spclient\\.spotify\\.com/ad-",
    ].join("|"),
    "i"
  );
  const AD_PATH_RE = /\/v\d\/ads?\/|\/ad-logic\/|\/ad-provider\/|fetchAdForSlot|ads\/v1\//i;

  function isAdUrl(url) {
    if (!url) return false;
    const s = typeof url === "string" ? url : (url.url || String(url));
    return AD_HOST_RE.test(s) || AD_PATH_RE.test(s);
  }

  let blockedCount = 0;
  function bumpCounter() {
    blockedCount++;
    Spicetify.LocalStorage.set("AdblockBlockedCount", String(blockedCount));
  }

  // -- fetch --
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url);
    if (isAdUrl(url)) {
      bumpCounter();
      return Promise.resolve(new Response(null, { status: 204, statusText: "No Content" }));
    }
    return realFetch(input, init);
  };

  // -- XMLHttpRequest --
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__swIsAd = isAdUrl(url);
    return realOpen.apply(this, arguments);
  };
  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__swIsAd) {
      bumpCounter();
      // Fake an empty-but-successful response instead of actually sending.
      Object.defineProperty(this, "readyState", { value: 4, configurable: true });
      Object.defineProperty(this, "status", { value: 204, configurable: true });
      Object.defineProperty(this, "response", { value: "", configurable: true });
      Object.defineProperty(this, "responseText", { value: "", configurable: true });
      setTimeout(() => {
        this.dispatchEvent(new Event("readystatechange"));
        this.dispatchEvent(new Event("load"));
        this.dispatchEvent(new Event("loadend"));
      }, 0);
      return;
    }
    return realSend.apply(this, arguments);
  };

  // -- <script>/<iframe> tags pointed at ad hosts (GPT tag, third-party pixels) --
  function stripIfAd(el) {
    const src = el.src || el.getAttribute("src") || "";
    if (isAdUrl(src)) {
      bumpCounter();
      el.remove();
      return true;
    }
    return false;
  }
  // Catch tags already in the DOM at injection time...
  Array.prototype.forEach.call(document.querySelectorAll("script[src], iframe[src]"), stripIfAd);
  // ...and any added afterward.
  new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.tagName === "SCRIPT" || node.tagName === "IFRAME") stripIfAd(node);
        Array.prototype.forEach.call(
          node.querySelectorAll ? node.querySelectorAll("script[src], iframe[src]") : [],
          stripIfAd
        );
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  Spicetify.Events.webpackLoaded.on(() => {
    new Spicetify.Menu.Item("Adblock (active)", true, () => {
      Spicetify.showNotification("Adblock has blocked " + blockedCount + " ad requests this session");
    }).register();
  });
})();

// ---- ext/ext-shuffle-mode.js ----
// ---- ext: shuffle modes (Off / Shuffle / Smart Shuffle) ----
// Spotify's own shuffle button is documented to cycle through three states
// on click in markets/accounts where Smart Shuffle has rolled out to
// desktop/web: Off -> Shuffle -> Smart Shuffle -> Off. There's no reliable
// aria-label/DOM signal to read "is Smart Shuffle currently on" from (label
// text and icon markup for it have changed across rollouts, and it isn't
// live for every account/region), so rather than guess at reading Spotify's
// true state, this tracks OUR OWN last-set mode in LocalStorage and clicks
// the real shuffle button the right number of times to walk it forward to
// the target state. If Smart Shuffle isn't available on your account, the
// 3rd click just wraps harmlessly back to Off -- same button either way.
(function ShuffleModesWeb() {
  const MODES = ["No shuffle", "Shuffle", "Smart shuffle"];
  const KEY = "ShuffleMode";

  function currentMode() {
    const v = parseInt(Spicetify.LocalStorage.get(KEY), 10);
    return isNaN(v) ? 0 : v;
  }
  function setMode(v) {
    Spicetify.LocalStorage.set(KEY, String(v));
  }

  function clickShuffle() {
    const b = Spicetify._dom.qs('[data-testid="control-button-shuffle"]');
    if (b) b.click();
    return !!b;
  }

  // Walk from whatever we last recorded to `target`, one real click per step.
  function goTo(target) {
    const from = currentMode();
    let steps = (target - from + MODES.length) % MODES.length;
    if (steps === 0 && from !== target) steps = MODES.length; // safety, shouldn't happen
    let clicked = 0;
    const tick = () => {
      if (clicked >= steps) {
        setMode(target);
        Spicetify.showNotification(MODES[target]);
        return;
      }
      if (!clickShuffle()) return; // no button on screen (e.g. nothing loaded) -- bail quietly
      clicked++;
      setTimeout(tick, 180);
    };
    tick();
  }

  Spicetify.Events.webpackLoaded.on(() => {
    const items = MODES.map((label, idx) =>
      new Spicetify.Menu.Item(label, currentMode() === idx, function (self) {
        goTo(idx);
        items.forEach((it, i) => it.setState(i === idx));
      })
    );
    items.forEach((it) => it.register());
  });
})();

// ---- end.js ----
})();

