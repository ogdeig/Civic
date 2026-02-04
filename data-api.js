// CivicThreat.us — Remote API client for Apps Script (JSONP to avoid CORS)
// Exposes BOTH:
//   window.CT_API    (preferred, used by app.js / submit page)
//   window.CT_REMOTE (legacy, used by older admin pages)
(function(){
  "use strict";

  function CFG(){ return (window.CT_CONFIG || {}); }

  function getBaseUrl(){
    const u = CFG()?.REMOTE_DB?.appsScriptUrl ? String(CFG().REMOTE_DB.appsScriptUrl) : "";
    if(!u) throw new Error("REMOTE_DB.appsScriptUrl missing in config.js");
    return u;
  }

  // Optional. If you don’t use keys, leave blank in config.js and the backend can ignore it.
  function getKey(){
    return CFG()?.REMOTE_DB?.apiKey ? String(CFG().REMOTE_DB.apiKey) : "";
  }

  function b64urlEncode(str){
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }

  function jsonp(params, timeoutMs=15000){
    return new Promise((resolve, reject)=>{
      const cbName = "__ct_cb_" + Math.random().toString(16).slice(2);
      const url = new URL(getBaseUrl());

      Object.entries(params || {}).forEach(([k,v])=>{
        if(v !== undefined && v !== null && String(v) !== "") url.searchParams.set(k, String(v));
      });

      // Optional key
      const key = getKey();
      if(key) url.searchParams.set("apiKey", key);

      url.searchParams.set("callback", cbName);
      url.searchParams.set("_", String(Date.now()));

      const script = document.createElement("script");
      script.async = true;
      const finalUrl = url.toString();

      // Debug helper
      window.__CT_LAST_REMOTE_URL = finalUrl;

      let done = false;
      const timer = setTimeout(()=>{
        if(done) return;
        done = true;
        cleanup();
        reject(new Error("Remote request timed out"));
      }, timeoutMs);

      function cleanup(){
        clearTimeout(timer);
        try{ delete window[cbName]; }catch(_){}
        if(script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = (data)=>{
        if(done) return;
        done = true;
        cleanup();
        resolve(data);
      };

      script.onerror = ()=>{
        if(done) return;
        done = true;
        cleanup();
        reject(new Error("Remote request failed to load"));
      };

      script.src = finalUrl;
      document.head.appendChild(script);
    });
  }

  async function call(params){
    const res = await jsonp(params);
    if(!res || res.ok !== true){
      throw new Error(res?.error || "Remote API error");
    }
    return res;
  }

  // Public API
  const API = {
    __transport: "jsonp",

    health: async ()=> await call({ action:"health" }),

    listApproved: async ()=> (await call({ action:"listApproved" })).items || [],
    listPending:  async ()=> (await call({ action:"listPending"  })).items || [],

    submit: async (item)=>{
      const payload = b64urlEncode(JSON.stringify({ item: item || {} }));
      return await call({ action:"submit", payload });
    },

    approve: async (id)=> await call({ action:"approve", id }),
    reject:  async (id)=> await call({ action:"reject", id }),
    deleteApproved: async (id)=> await call({ action:"deleteApproved", id }),

    // Reactions
    react: async (id, dir)=>{
      // dir: "up" or "down"
      return await call({ action:"react", id, dir });
    }
  };

  // Preferred
  window.CT_API = API;

  // Back-compat for any pages still expecting CT_REMOTE
  window.CT_REMOTE = API;

})();
