/**
 * data-api.js — CivicThreat.us
 * JSONP client for Google Apps Script backend.
 *
 * Why JSONP?
 * - GitHub Pages cannot do cross-origin XHR/fetch to Apps Script without CORS headers.
 * - JSONP works via <script> injection.
 */

(function(){
  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error("JSONP load failed: " + src));
      document.head.appendChild(s);
    });
  }

  function b64url(str){
    // base64url for Apps Script payload parameter
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  }

  function call(params){
    return new Promise(async (resolve, reject)=>{
      try{
        const cfg = window.CT_CONFIG || {};
        const urlBase = cfg.API_URL;
        const apiKey = cfg.API_KEY;

        if(!urlBase) throw new Error("CT_CONFIG.API_URL missing");
        if(!apiKey) throw new Error("CT_CONFIG.API_KEY missing");

        const cbName = "__ct_cb_" + Math.random().toString(36).slice(2);
        window[cbName] = (data)=>{
          try { delete window[cbName]; } catch(_){}
          resolve(data);
        };

        const qp = new URLSearchParams();
        qp.set("callback", cbName);
        qp.set("apiKey", apiKey);

        Object.keys(params||{}).forEach(k=>{
          if(params[k] === undefined || params[k] === null) return;
          if(k === "payload"){
            qp.set("payload", b64url(JSON.stringify(params[k])));
          } else {
            qp.set(k, String(params[k]));
          }
        });

        const full = urlBase + (urlBase.includes("?") ? "&" : "?") + qp.toString();
        await loadScript(full);
      } catch(err){
        reject(err);
      }
    });
  }

  window.CT_REMOTE = {
    health: async ()=> await call({ action:"health" }),

    listApproved: async ()=> await call({ action:"listApproved" }),
    listPending: async ()=> await call({ action:"listPending" }),

    submit: async (item)=> await call({ action:"submit", payload:{ item } }),
    approve: async (id)=> await call({ action:"approve", id }),
    reject: async (id)=> await call({ action:"reject", id }),

    deleteApproved: async (id)=> await call({ action:"deleteApproved", id }),
    react: async (id, kind)=> await call({ action:"react", id, kind })
  };
})();
