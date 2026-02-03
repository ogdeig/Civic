/* data-api.js — CivicThreat.us (JSONP + Apps Script, no API key) */
(function(){
  const CFG = window.CT_CONFIG || {};
  const REMOTE = (CFG.REMOTE_DB || {});
  const BASE = (REMOTE.appsScriptUrl || "").trim();

  function assertBase(){
    if (!BASE) throw new Error("CT_CONFIG.REMOTE_DB.appsScriptUrl missing (config.js)");
  }

  // JSONP helper
  function jsonp(action, params){
    assertBase();
    params = params || {};
    return new Promise((resolve, reject) => {
      const cb = "ct_cb_" + Math.random().toString(36).slice(2);
      const cleanup = () => {
        try { delete window[cb]; } catch(e){}
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      window[cb] = function(payload){
        cleanup();
        if (!payload || payload.ok === false) {
          reject(new Error((payload && payload.error) ? payload.error : "request_failed"));
          return;
        }
        resolve(payload);
      };

      const qs = new URLSearchParams();
      qs.set("action", action);
      qs.set("callback", cb);

      Object.keys(params).forEach(k => {
        if (params[k] === undefined || params[k] === null) return;
        qs.set(k, String(params[k]));
      });

      const url = BASE + (BASE.includes("?") ? "&" : "?") + qs.toString();

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("network_error"));
      };
      document.head.appendChild(script);
    });
  }

  function b64(obj){
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    bytes.forEach(b => bin += String.fromCharCode(b));
    const base64 = btoa(bin);
    // websafe
    return base64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }

  // Public API used by app.js
  window.CT_API = {
    async health(){
      const res = await jsonp("health");
      return res;
    },

    async listApproved(){
      const res = await jsonp("listApproved");
      return (res.items || []);
    },

    async listPending(){
      const res = await jsonp("listPending");
      return (res.items || []);
    },

    async submit(item){
      const payload = b64({ item });
      const res = await jsonp("submit", { payload });
      return res;
    },

    async react(id, dir){
      const res = await jsonp("react", { id, dir });
      return res; // { reactionsUp, reactionsDown }
    }
  };
})();
