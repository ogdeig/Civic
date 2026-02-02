/* global window, document */
(function(){
  "use strict";

  function getConfig(){
    if(!window.CT_CONFIG) throw new Error("CT_CONFIG missing (config.js not loaded?)");
    return window.CT_CONFIG;
  }

  function getRemote(){
    const cfg = getConfig();

    // Prefer REMOTE_DB, but allow old keys too
    const appsScriptUrl =
      (cfg.REMOTE_DB && cfg.REMOTE_DB.appsScriptUrl) ||
      cfg.API_URL ||
      "";

    const apiKey =
      (cfg.REMOTE_DB && cfg.REMOTE_DB.apiKey) ||
      cfg.API_KEY ||
      "";

    const enabled = !!(cfg.REMOTE_DB ? cfg.REMOTE_DB.enabled : true);

    if(!appsScriptUrl) throw new Error("Apps Script URL missing (CT_CONFIG.REMOTE_DB.appsScriptUrl / CT_CONFIG.API_URL)");
    return { enabled, appsScriptUrl, apiKey };
  }

  function b64urlEncode(str){
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach(b => bin += String.fromCharCode(b));
    const b64 = btoa(bin);
    return b64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }

  function jsonp(url, timeoutMs=20000){
    return new Promise((resolve, reject)=>{
      const cb = "ct_jsonp_" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const t = setTimeout(()=>cleanup(new Error("timeout")), timeoutMs);

      function cleanup(err){
        clearTimeout(t);
        try { delete window[cb]; } catch(_){}
        if(s && s.parentNode) s.parentNode.removeChild(s);
        err ? reject(err) : null;
      }

      window[cb] = (data)=>{ cleanup(); resolve(data); };
      s.onerror = ()=>cleanup(new Error("jsonp failed"));
      s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + encodeURIComponent(cb);
      document.head.appendChild(s);
    });
  }

  async function call(params){
    const remote = getRemote();
    if(!remote.enabled) return { ok:false, error:"remote_disabled" };

    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach(k=>{
      const v = params[k];
      if(v === undefined || v === null) return;
      if(typeof v === "object"){
        qs.set(k, b64urlEncode(JSON.stringify(v)));
      } else {
        qs.set(k, String(v));
      }
    });

    if(remote.apiKey) qs.set("apiKey", remote.apiKey);

    const url = remote.appsScriptUrl + (remote.appsScriptUrl.includes("?") ? "&" : "?") + qs.toString();
    const res = await jsonp(url);
    return res;
  }

  window.CT_REMOTE = {
    __transport: "jsonp",
    listApproved: async ()=> (await call({ action:"listApproved" })).items || [],
    listPending:  async ()=> (await call({ action:"listPending"  })).items || [],

    submit:  async (item)=> await call({ action:"submit", payload:{ item } }),
    approve: async (id)=> await call({ action:"approve", id }),
    reject:  async (id)=> await call({ action:"reject", id }),
    deleteApproved: async (id)=> await call({ action:"deleteApproved", id }),

    // NEW: reactions
    react: async (id, dir)=> await call({ action:"react", id, dir })
  };
})();
