/* CivicThreat.us — Data API client (JSONP) */
(function(){
  const CTData = {};

  function CFG(){ return (window.CT_CONFIG || {}); }
  function getKey(){
    const cfg = CFG();
    const k = (cfg.REMOTE_DB && cfg.REMOTE_DB.apiKey) ? cfg.REMOTE_DB.apiKey : '';
    return String(k || '').trim();
  }

  function getUrl(){
    const cfg = CFG();

    // Preferred (current)
    const v1 = cfg && cfg.REMOTE_DB && cfg.REMOTE_DB.appsScriptUrl;
    if (v1) return String(v1).trim();

    // Backward-compat (older configs people may still have deployed)
    const v2 = cfg && (cfg.API_URL || cfg.APPS_SCRIPT_URL || cfg.appsScriptUrl);
    if (v2) return String(v2).trim();

    throw new Error("CT_CONFIG.REMOTE_DB.appsScriptUrl missing");
  }

  function jsonp(url){
    return new Promise((resolve, reject)=>{
      const cb = `__ct_jsonp_${Date.now()}_${Math.floor(Math.random()*1e9)}`;
      const script = document.createElement("script");
      const sep = url.includes("?") ? "&" : "?";
      script.src = `${url}${sep}callback=${cb}`;
      script.async = true;

      const t = setTimeout(()=>{
        cleanup();
        reject(new Error("timeout"));
      }, 15000);

      function cleanup(){
        clearTimeout(t);
        try{ delete window[cb]; }catch{}
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[cb] = (data)=>{
        cleanup();
        resolve(data);
      };

      script.onerror = ()=>{
        cleanup();
        reject(new Error("jsonp_error"));
      };

      document.head.appendChild(script);
    });
  }

  function buildUrl(params){
    const base = getUrl();
    const qs = new URLSearchParams(params);
    return `${base}?${qs.toString()}`;
  }

  async function call(params){
    const apiKey = getKey();
    const full = buildUrl({ ...params, apiKey });
    return await jsonp(full);
  }

  // Public methods
  CTData.health = async ()=> await jsonp(buildUrl({ action:"health" }));
  CTData.listApproved = async ()=> await call({ action:"listApproved" });
  CTData.listPending  = async ()=> await call({ action:"listPending" });
  CTData.submit = async (payloadB64)=> await call({ action:"submit", payload: payloadB64 });
  CTData.approve = async (id)=> await call({ action:"approve", id });
  CTData.reject = async (id)=> await call({ action:"reject", id });
  CTData.deleteApproved = async (id)=> await call({ action:"deleteApproved", id });
  CTData.react = async ({id, dir})=> await call({ action:"react", id, dir });

  window.CTData = CTData;
})();
