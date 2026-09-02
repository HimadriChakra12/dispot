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
