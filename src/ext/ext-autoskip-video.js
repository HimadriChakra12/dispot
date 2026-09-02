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
