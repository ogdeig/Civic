/* data-api.js — CivicThreat.us (JSONP client for Apps Script) */
(function () {
  "use strict";

  const CFG = window.CT_CONFIG || {};

  function requireApiUrl() {
    const url = (CFG.API_URL || "").trim();
    if (!url) throw new Error("CT_CONFIG.API_URL missing");
    return url;
  }

  function encodePayload(obj) {
    const json = JSON.stringify(obj || {});
    // websafe base64
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return b64;
  }

  function jsonp(action, params) {
    const base = requireApiUrl();

    return new Promise((resolve, reject) => {
      const cbName = "ctcb_" + Math.random().toString(36).slice(2);
      const cleanup = (script) => {
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      window[cbName] = (data) => {
        cleanup(script);
        if (!data || data.ok !== true) {
          reject(new Error((data && data.error) ? data.error : "unknown_error"));
          return;
        }
        resolve(data);
      };

      const q = new URL(base);
      q.searchParams.set("action", action);
      q.searchParams.set("callback", cbName);

      if (params) {
        Object.keys(params).forEach((k) => {
          const v = params[k];
          if (v === undefined || v === null) return;
          q.searchParams.set(k, String(v));
        });
      }

      const script = document.createElement("script");
      script.src = q.toString();
      script.async = true;
      script.onerror = () => {
        cleanup(script);
        reject(new Error("network_error"));
      };
      document.head.appendChild(script);
    });
  }

  async function listApproved() {
    const res = await jsonp("listApproved");
    return res.items || [];
  }

  async function listPending() {
    const res = await jsonp("listPending");
    return res.items || [];
  }

  async function submit(item) {
    const payload = encodePayload({ item });
    await jsonp("submit", { payload });
    return true;
  }

  async function approve(id) {
    await jsonp("approve", { id });
    return true;
  }

  async function reject(id) {
    await jsonp("reject", { id });
    return true;
  }

  async function deleteApproved(id) {
    await jsonp("deleteApproved", { id });
    return true;
  }

  async function react(id, dir) {
    const res = await jsonp("react", { id, dir });
    return { reactionsUp: res.reactionsUp || 0, reactionsDown: res.reactionsDown || 0 };
  }

  // Public API used by pages
  window.CT_API = {
    listApproved,
    listPending,
    submit,
    approve,
    reject,
    deleteApproved,
    react
  };

  // Admin expects CT_REMOTE sometimes
  window.CT_REMOTE = window.CT_API;
})();
