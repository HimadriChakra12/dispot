# spicetify-web

A Tampermonkey/Violentmonkey userscript that ports spicetify's extension API
and theme compatibility onto `open.spotify.com`, for when you can't run the
desktop app. Built with the same C-based bundler as bundlejs — no
Node/yarn/bun, just `make`.

## Build

    make build          # -> dist/spicetify-web.user.js
    make watch          # rebuild on save (needs inotifywait)

Install `dist/spicetify-web.user.js` in Tampermonkey/Violentmonkey.

## Structure

    src/start.js                    IIFE open
    src/01-shim.js                  Spicetify global: LocalStorage, Player,
                                     Menu.Item, Events.webpackLoaded, showNotification
    src/02-ext-autoskip-explicit.js first ported extension (spicetify/cli's
                                     autoSkipExplicit.js), proves the shim works
    src/03-theme-dom-patch.js       stamps desktop-style class names
                                     (.main-trackInfo-name, .Root__nav-bar, ...)
                                     onto the web player's DOM so your existing
                                     spicetify theme CSS has selectors to match
    src/end.js                      IIFE close
    tools/build.c, build.h          same bundler as bundlejs, @match set to
                                     open.spotify.com, version pulled from
                                     tools/VERSION

## Why it's a shim, not a real port

Real spicetify patches Spotify's own `xpui.js` inside the Electron app, so
extensions get the actual internal `Spicetify.Platform` API. On the web
player there's no equivalent injection point, and the webpack chunk/module
IDs churn on every deploy — hardcoding them would just break in a week.
`01-shim.js` instead rebuilds the pieces extensions use most (player state,
menu injection, notifications, storage) from `data-testid` attributes, which
Spotify keeps stable across redesigns far more than class names or webpack
internals do.

Practically: extensions that only touch `Spicetify.Player`, `LocalStorage`,
`Menu.Item`, and `showNotification` — like `autoSkipExplicit.js` — port with
small edits. Extensions that reach into `Spicetify.Platform.PlayerAPI` or
`CosmosAsync` directly (webnowplaying, popupLyrics, fullAppDisplay) will need
more work per-extension; the shim doesn't fake those yet.

## Theme patch (03-theme-dom-patch.js)

Your theme CSS targets desktop class names like `.main-trackInfo-name`. The
web player uses hashed CSS-module classnames that change every build, so
none of it matched. This module watches the DOM and re-adds the desktop
class names onto the matching web elements (keyed off `data-testid`) every
time React re-renders them. Drop your existing theme's `color.ini`-derived
CSS in via a `GM_addStyle` block or Stylus and it should now have something
to hook onto. The selector map in `SW_MAP` covers the now-playing bar,
transport controls, nav, and search — extend it if your theme reaches
further (queue, library rows, etc.) and something still doesn't apply.

## Next

- Port `shuffle+.js` and `trashbin.js` onto the shim (both are DOM/UI heavy,
  should be the next easiest after autoSkipExplicit)
- Extend `SW_MAP` as you find un-themed spots
- `webnowplaying.js` / `popupLyrics.js` need real playback data (position,
  lyrics sync) that DOM polling can only approximate — lower priority
