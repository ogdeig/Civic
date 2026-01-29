/* Remote DB adapter (Google Sheets via Apps Script Web App)
   - Configure in config.js: CT_CONFIG.REMOTE_DB
   - If disabled or unreachable, the app falls back to local storage.
*/
async function remoteFetch(path, options={}){
  const cfg = window.CT_CONFIG.REMOTE_DB || {};
  const base = (cfg.appsScriptUrl || "").replace(/\/$/,"");
  if(!cfg.enabled || !base) throw new Error("REMOTE_DB not configured");
  const headers = Object.assign({"Content-Type":"application/json"}, options.headers||{});
  if(cfg.apiKey) headers["X-CT-KEY"] = cfg.apiKey;
  const res = await fetch(base + path, Object.assign({}, options, {headers}));
  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error("Remote error: " + res.status + " " + t);
  }
  return res.json();
}

window.CT_REMOTE = {
  async listApproved(){ return remoteFetch("/approved"); },
  async listPending(){ return remoteFetch("/pending"); },
  async submit(item){ return remoteFetch("/submit", {method:"POST", body: JSON.stringify(item)}); },
  async approve(id){ return remoteFetch("/approve", {method:"POST", body: JSON.stringify({id})}); },
  async reject(id){ return remoteFetch("/reject", {method:"POST", body: JSON.stringify({id})}); }
};
