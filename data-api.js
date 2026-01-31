// CivicThreat.us — Remote API client for Apps Script (JSONP to avoid CORS)
(function(){
  "use strict";

  function CFG(){ return (window.CT_CONFIG || {}); }

  function getUrl(){
    const u = CFG()?.REMOTE_DB?.appsScriptUrl ? String(CFG().REMOTE_DB.appsScriptUrl) : "";
    if(!u) throw new Error("REMOTE_DB.appsScriptUrl missing in config.js");
    return u;
  }

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
      const url = new URL(getUrl());

      Object.entries(params || {}).forEach(([k,v])=>{
        if(v !== undefined && v !== null && String(v) !== "") url.searchParams.set(k, String(v));
      });

      const key = getKey();
      if(key) url.searchParams.set("apiKey", key);
      url.searchParams.set("callback", cbName);
      url.searchParams.set("_", String(Date.now()));

      const script = document.createElement("script");
      script.async = true;
      script.src = url.toString();

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

  window.CT_REMOTE = {
    listApproved: async ()=> (await call({ action:"listApproved" })).items || [],
    listPending:  async ()=> (await call({ action:"listPending"  })).items || [],
    submit: async (item)=>{
      const payload = b64urlEncode(JSON.stringify({ item: item || {} }));
      return await call({ action:"submit", payload });
    },
    approve: async (id)=> await call({ action:"approve", id }),
    reject:  async (id)=> await call({ action:"reject", id }),
    deleteApproved: async (id)=> await call({ action:"deleteApproved", id })
  };
})();
