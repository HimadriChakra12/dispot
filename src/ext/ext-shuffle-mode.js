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
