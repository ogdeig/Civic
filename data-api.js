/*
  CivicThreat.us — data-api.js
  JSONP client for Google Apps Script backend.

  Config (config.js):
    window.CT_CONFIG.REMOTE_DB.appsScriptUrl  (required)
    window.CT_CONFIG.REMOTE_DB.apiKey        (optional)
*/

(function () {
  "use strict";

  function getCfg_() {
    const cfg = window.CT_CONFIG || {};
    const rdb = cfg.REMOTE_DB || {};

    // Support older config names if you had them
    const appsScriptUrl = (rdb.appsScriptUrl || cfg.API_URL || cfg.APP_SCRIPT_URL || "").trim();
    const apiKey = (rdb.apiKey || cfg.API_KEY || "").trim();
    const enabled = (typeof rdb.enabled === "boolean") ? rdb.enabled : true;

    if (!enabled) throw new Error("REMOTE_DB disabled");
    if (!appsScriptUrl) throw new Error("CT_CONFIG.REMOTE_DB.appsScriptUrl missing");

    return { appsScriptUrl, apiKey };
  }

  function jsonp_(url, params) {
    return new Promise((resolve, reject) => {
      const cbName = "__ct_cb_" + Math.random().toString(36).slice(2);

      params = params || {};
      params.callback = cbName;

      const qs = Object.keys(params)
        .filter(k => params[k] !== undefined && params[k] !== null && String(params[k]).length > 0)
        .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])))
        .join("&");

      const src = url + (url.includes("?") ? "&" : "?") + qs;

      const script = document.createElement("script");
      let done = false;

      window[cbName] = function (payload) {
        done = true;
        cleanup_();
        resolve(payload);
      };

      function cleanup_() {
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      script.onerror = function () {
        if (done) return;
        cleanup_();
        reject(new Error("JSONP request failed"));
      };

      script.src = src;
      document.head.appendChild(script);
    });
  }

  function call_(action, extra) {
    const { appsScriptUrl, apiKey } = getCfg_();
    const params = Object.assign({ action }, (extra || {}));

    // Only send apiKey if it exists
    if (apiKey) params.apiKey = apiKey;

    return jsonp_(appsScriptUrl, params).then(res => {
      if (!res || res.ok !== true) {
        const err = (res && (res.error || res.message)) ? (res.error || res.message) : "unknown_error";
        throw new Error(err);
      }
      return res;
    });
  }

  function b64url_(obj) {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  window.CT_API = {
    health: () => call_("health"),

    // Public
    listApproved: () => call_("listApproved").then(r => r.items || []),
    react: (id, dir) => call_("react", { id, dir })
      .then(r => ({ reactionsUp: Number(r.reactionsUp || 0), reactionsDown: Number(r.reactionsDown || 0) })),

    // Admin / protected (requires apiKey if your Code.gs enforces it)
    listPending: () => call_("listPending").then(r => r.items || []),
    submit: (item) => call_("submit", { payload: b64url_({ item }) }),
    approve: (id) => call_("approve", { id }),
    reject: (id) => call_("reject", { id }),
    deleteApproved: (id) => call_("deleteApproved", { id }),
  };
})();
