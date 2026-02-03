/* CivicThreat.us — data-api.js (NO API KEY)
   JSONP wrapper so GitHub Pages / static hosting can call Apps Script without CORS.
*/

(function () {
  const CFG = (window.CT_CONFIG && window.CT_CONFIG.REMOTE_DB) ? window.CT_CONFIG.REMOTE_DB : null;

  function requireUrl() {
    if (!CFG || !CFG.appsScriptUrl) {
      throw new Error("CT_CONFIG.REMOTE_DB.appsScriptUrl missing in config.js");
    }
    return CFG.appsScriptUrl;
  }

  function b64(obj) {
    const json = JSON.stringify(obj);
    // Web-safe base64
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "ct_cb_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      let done = false;

      const cleanup = () => {
        if (script && script.parentNode) script.parentNode.removeChild(script);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      };

      window[cb] = (data) => {
        done = true;
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP request failed"));
      };

      // Safety timeout
      setTimeout(() => {
        if (!done) {
          cleanup();
          reject(new Error("JSONP timeout"));
        }
      }, 20000);

      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
      document.body.appendChild(script);
    });
  }

  function call(action, params) {
    const base = requireUrl();
    const u = new URL(base);

    u.searchParams.set("action", action);

    if (params && Object.keys(params).length) {
      // If payload, send as payload=base64json (keeps URLs clean)
      if (params.payload) {
        u.searchParams.set("payload", b64(params.payload));
      } else {
        Object.entries(params).forEach(([k, v]) => {
          if (v === undefined || v === null) return;
          u.searchParams.set(k, String(v));
        });
      }
    }

    return jsonp(u.toString()).then((res) => {
      if (!res || res.ok !== true) {
        const msg = (res && res.error) ? res.error : "request_failed";
        throw new Error(msg);
      }
      return res;
    });
  }

  // Per-browser stable id (for optional server-side rate limiting)
  function getClientId() {
    const KEY = "ct_client_id";
    let id = "";
    try { id = localStorage.getItem(KEY) || ""; } catch (e) {}
    if (!id) {
      id = "ct_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
    return id;
  }

  window.CT_API = {
    health: () => call("health"),
    listApproved: () => call("listApproved").then(r => r.items || []),
    listPending:  () => call("listPending").then(r => r.items || []),

    submit: (item) => call("submit", { payload: { item } }).then(() => true),

    // dir: "up" | "down"
    react: (id, dir) => call("react", { id, dir, clientId: getClientId() })
      .then(r => ({ reactionsUp: r.reactionsUp, reactionsDown: r.reactionsDown }))
  };
})();
