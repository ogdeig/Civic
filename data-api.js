// Remote DB connector (Google Sheets via Apps Script Web App)
// Enable in config.js (CT_CONFIG.REMOTE_DB.enabled = true) and set appsScriptUrl.
(function(){
  "use strict";

  async function remoteFetch(payload){
    const cfg = (window.CT_CONFIG && window.CT_CONFIG.REMOTE_DB) ? window.CT_CONFIG.REMOTE_DB : null;
    if(!cfg || !cfg.appsScriptUrl) throw new Error("REMOTE_DB not configured");
    const body = Object.assign({}, payload, { apiKey: cfg.apiKey || "" });

    const res = await fetch(cfg.appsScriptUrl, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if(!res.ok){
      const txt = await res.text().catch(()=> "");
      throw new Error("Remote error: " + res.status + " " + txt.slice(0,160));
    }
    const data = await res.json();
    if(data && data.ok === false) throw new Error(data.error || "Remote error");
    return data;
  }

  async function listApproved(){
    const data = await remoteFetch({ action:"listApproved" });
    return Array.isArray(data.items) ? data.items : [];
  }

  async function listPending(){
    const data = await remoteFetch({ action:"listPending" });
    return Array.isArray(data.items) ? data.items : [];
  }

  async function submit(item){
    const data = await remoteFetch({ action:"submit", item });
    return data;
  }

  async function approve(id){
    const data = await remoteFetch({ action:"approve", id });
    return data;
  }

  async function reject(id){
    const data = await remoteFetch({ action:"reject", id });
    return data;
  }

  window.CT_REMOTE = { listApproved, listPending, submit, approve, reject };
})();
