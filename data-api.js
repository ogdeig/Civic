/* data-api.js — CivicThreat.us (JSONP client for Apps Script) */
(function () {
  "use strict";

  function CFG(){ return window.CT_CONFIG || {}; }

  function requireAppsScriptUrl() {
    const cfg = CFG();
    const remote = cfg.REMOTE_DB || {};
    const url = String(remote.appsScriptUrl || "").trim();
    if (!remote.enabled) throw new Error("REMOTE_DB is disabled. Enable it in config.js.");
    if (!url) throw new Error("CT_CONFIG.REMOTE_DB.appsScriptUrl missing");
    return url;
  }

  function getApiKeyMaybe() {
    const remote = (CFG().REMOTE_DB || {});
    return String(remote.apiKey || "").trim(); // may be blank (fine if Apps Script doesn’t require it)
  }

  function encodePayload(obj) {
    const json = JSON.stringify(obj || {});
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return b64;
  }

  function jsonp(action, params) {
    const base = requireAppsScriptUrl();
    const apiKey = getApiKeyMaybe();

    return new Promise((resolve, reject) => {
      const cbName = "ctcb_" + Math.random().toString(36).slice(2);
      let script = null;

      const cleanup = () => {
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      window[cbName] = (data) => {
        cleanup();
        if (!data || data.ok !== true) {
          reject(new Error((data && data.error) ? data.error : "unknown_error"));
          return;
        }
        resolve(data);
      };

      const u = new URL(base);
      u.searchParams.set("action", action);
      u.searchParams.set("callback", cbName);

      // only send apiKey if present (keeps your “no key” preference)
      if (apiKey) u.searchParams.set("apiKey", apiKey);

      if (params) {
        Object.keys(params).forEach((k) => {
          const v = params[k];
          if (v === undefined || v === null) return;
          u.searchParams.set(k, String(v));
        });
      }

      script = document.createElement("script");
      script.src = u.toString();
      script.async = true;
      script.onerror = () => {
        cleanup();
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

  window.CT_API = { listApproved, listPending, submit, approve, reject, deleteApproved, react };
  window.CT_REMOTE = window.CT_API; // admin compatibility
})();
