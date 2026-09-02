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
