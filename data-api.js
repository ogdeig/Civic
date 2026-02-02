/* CivicThreat.us data API
   Uses JSONP-style calls to a Google Apps Script endpoint (no CORS headaches).
*/
(function(){
  "use strict";

  function bust(){ return String(Date.now()); }

  // JSONP call
  function call(params){
    return new Promise((resolve, reject) => {
      const cfg = window.CT_CONFIG || {};
      const endpoint = cfg.appsScriptUrl || cfg.APPS_SCRIPT_URL || cfg.apps_script_url;
      if(!endpoint) return reject(new Error("Missing CT_CONFIG.appsScriptUrl in config.js"));

      const cb = "cb_" + Math.random().toString(16).slice(2);
      const url = new URL(endpoint);

      // Add all params
      Object.entries(params || {}).forEach(([k,v]) => {
        if(v === undefined || v === null) return;
        url.searchParams.set(k, String(v));
      });

      // Cache bust + callback
      url.searchParams.set("callback", cb);
      url.searchParams.set("_", bust());

      const script = document.createElement("script");
      script.async = true;
      script.src = url.toString();

      const cleanup = () => {
        try{ delete window[cb]; }catch(_){}
        if(script && script.parentNode) script.parentNode.removeChild(script);
      };

      window[cb] = (data) => {
        cleanup();
        if(data && data.ok === false){
          reject(new Error(data.error || "API error"));
        }else{
          resolve(data);
        }
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("API request failed"));
      };

      document.head.appendChild(script);
    });
  }

  // Public API
  window.CT_REMOTE = {
    listApproved: async ({ platform="facebook", category="support", limit=48 }={}) =>
      await call({ action:"listApproved", platform, category, limit }),

    listPending: async ({ limit=200 }={}) =>
      await call({ action:"listPending", limit }),

    submit: async (payload) => await call({ action:"submit", payload: JSON.stringify(payload || {}) }),

    approve: async (id) => await call({ action:"approve", id }),

    reject: async (id) => await call({ action:"reject", id }),

    // Reactions (increment per post)
    // kind: "up" (support) or "down" (maga)
    react: async ({ id, kind }) => await call({ action:"react", id, kind }),

    deleteApproved: async (id) => await call({ action:"deleteApproved", id })
  };

})();
