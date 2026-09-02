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
