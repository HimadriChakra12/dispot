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
