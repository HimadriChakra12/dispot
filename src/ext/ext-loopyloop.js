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
