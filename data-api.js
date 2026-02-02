/* data-api.js — CivicThreat.us JSONP client (GitHub Pages friendly) */
(function () {
  const CFG = window.CT_CONFIG || {};

  function ensureUrl() {
    const url = (CFG.APPS_SCRIPT_URL || "").trim();
    if (!url) throw new Error("CT_CONFIG.APPS_SCRIPT_URL missing");
    return url;
  }

  function jsonp(url, params) {
    return new Promise((resolve, reject) => {
      const cb = "ct_cb_" + Math.random().toString(36).slice(2);
      params = params || {};
      params.callback = cb;

      const q = Object.keys(params)
        .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])))
        .join("&");

      const src = url + (url.includes("?") ? "&" : "?") + q;

      const s = document.createElement("script");
      let done = false;

      window[cb] = (data) => {
        done = true;
        cleanup();
        resolve(data);
      };

      function cleanup() {
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }

      s.onerror = () => {
        if (done) return;
        cleanup();
        reject(new Error("JSONP request failed"));
      };

      document.head.appendChild(s);
      s.src = src;
    });
  }

  function call(action, extra) {
    const url = ensureUrl();
    const params = Object.assign({ action }, extra || {});
    return jsonp(url, params).then(res => {
      if (!res || res.ok !== true) {
        const msg = (res && (res.error || res.message)) ? (res.error || res.message) : "request_failed";
        throw new Error(msg);
      }
      return res;
    });
  }

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach(b => bin += String.fromCharCode(b));
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return b64;
  }

  window.CT_API = {
    health: () => call("health"),

    listApproved: () => call("listApproved").then(r => r.items || []),
    listPending:  () => call("listPending").then(r => r.items || []),

    submit: (item) => {
      const payload = b64urlEncode(JSON.stringify({ item }));
      return call("submit", { payload }).then(() => true);
    },

    approve: (id) => call("approve", { id }).then(() => true),
    reject:  (id) => call("reject", { id }).then(() => true),
    deleteApproved: (id) => call("deleteApproved", { id }).then(() => true),

    react: (id, dir) => call("react", { id, dir }).then(r => ({
      reactionsUp: Number(r.reactionsUp || 0),
      reactionsDown: Number(r.reactionsDown || 0)
    }))
  };
})();
