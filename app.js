
const LS = { approved: "ct3_approved_posts", pending: "ct3_pending_submissions", seeded: "ct3_seed_loaded", cookieOk: "ct3_cookie_ok"
}; function basePath(){ // When served from /admin/ folder, assets/scripts are one level up return location.pathname.includes("/admin/") ? "../" : "./";
} function nowIso(){ return new Date().toISOString(); }
function safeParse(s, fb){ try{ return JSON.parse(s);}catch{ return fb; } }
function getList(k, fb=[]){ return safeParse(localStorage.getItem(k) || "null", null) ?? fb; }
function setList(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function uid(prefix="id"){ return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`; } function canUseLocalStorage(){ try{ const k="__ct_test"; localStorage.setItem(k,"1"); localStorage.removeItem(k); return true; }catch{ return false; }
} async function ensureSeed(){ if(localStorage.getItem(LS.seeded)) return; try{ const res = await fetch(basePath() + "data/seed.json", {cache:"no-store"}); const seed = await res.json(); const approved = await dbListApproved(); setList(LS.approved, [...seed.posts, ...approved]); }catch(e){ console.warn("Seed failed:", e); }finally{ localStorage.setItem(LS.seeded, "1"); }
} function el(sel, root=document){ return root.querySelector(sel); } function escapeHtml(str=""){ return String(str) .replaceAll("&","&amp;") .replaceAll("<","&lt;") .replaceAll(">","&gt;") .replaceAll('"',"&quot;") .replaceAll("'","&#039;");
} function fbPluginSrc(fbUrl){ const href = encodeURIComponent(fbUrl); return `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=500`;
}
function stripFragment(url){ return url.replace(/#.*$/, "").trim(); } function extractFacebookUrl(input){ if(!input) return ""; const s = input.trim(); if(/https?:\/\/(www\.)?facebook\.com\//i.test(s) && !/[<>]/.test(s)) return stripFragment(s); let m = s.match(/data-href\s*=\s*["']([^"']+facebook\.com[^"']+)["']/i); if(m && m[1]) return stripFragment(m[1]); m = s.match(/\bhref\s*=\s*["']([^"']+facebook\.com[^"']+)["']/i); if(m && m[1] && !m[1].includes("plugins/post.php")) return stripFragment(m[1]); m = s.match(/plugins\/post\.php\?[^"']*href=([^&"']+)/i); if(m && m[1]){ try{ return stripFragment(decodeURIComponent(m[1])); }catch{ return stripFragment(m[1]); } } return "";
} function formatSubmittedBy(sb){ const display = (sb && sb.display) ? sb.display : "Anonymous"; const url = sb && sb.url ? sb.url : ""; if(url){ return `<span class="submitted">Submitted by <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(display)}</a></span>`; } return `<span class="submitted">Submitted by ${escapeHtml(display)}</span>`;
} function mountFooter(){
  const bp = BASE_PATH;
  const el = document.createElement("footer");
  el.className = "site-footer";
  el.innerHTML = `
    <div class="footer-inner">
      <div>
        <div class="footer-brand">
          <a href="${bp}index.html" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:#fff;">
            <img src="${bp}assets/logo.png" alt="Civic Threat"/>
            <div>
              <div style="font-weight:900;letter-spacing:.6px;">CIVIC THREAT</div>
              <div style="font-size:12px;opacity:.9;">Debate &amp; Discuss</div>
            </div>
          </a>
        </div>
        <div class="footer-copy">© ${new Date().getFullYear()} Civic Threat. All rights reserved.</div>
      </div>

      <div class="footer-links">
        <a href="${bp}about.html">About</a>
        <a href="${bp}advertising-disclosure.html">Advertising</a>
        <a href="${bp}terms.html">Terms</a>
        <a href="${bp}privacy.html">Privacy</a>
        <a href="${bp}cookies.html">Cookies</a>
        <a href="${bp}contact.html">Contact</a>
      </div>

      <div class="iconrow" aria-label="Civic Threat social links">
        <a class="btn iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8h2.7l.4-3H13.5V9.1c0-.9.3-1.6 1.6-1.6H16.7V4.7c-.3 0-1.4-.2-2.7-.2-2.7 0-4.5 1.6-4.5 4.6V11H6.7v3h2.8v8h4z"/></svg></a>
        <a class="btn iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.7 31.7 0 0 0 2 12a31.7 31.7 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 22 12a31.7 31.7 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg></a>
        <a class="btn iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3c.4 2.4 1.9 4.3 4.1 5v3.3c-2 0-3.8-.6-5.3-1.7v6.6c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6c.4 0 .8 0 1.2.1v3.5c-.4-.1-.8-.2-1.2-.2-1.4 0-2.5 1.1-2.5 2.5S8 18.5 9.4 18.5s2.6-1 2.6-2.5V3h4.5z"/></svg></a>
        <a class="btn iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.6l-5.2-6.7L5.4 22H2.3l7.3-8.4L1 2h6.8l4.7 6.1L18.9 2zm-1.1 18h1.7L6.1 3.9H4.3L17.8 20z"/></svg></a>
      </div>
    </div>
  `;
  document.body.appendChild(el);
} function initDropdowns(){ document.addEventListener("click", (e)=>{ const toggle = e.target.closest("[data-dd-toggle]"); const open = document.querySelector(".dropdown.open"); if(toggle){ const dd = toggle.closest(".dropdown"); if(open && open !== dd) open.classList.remove("open"); dd.classList.toggle("open"); return; } if(open && !e.target.closest(".dropdown")){ open.classList.remove("open"); } });
} function initCookieBar(){ const ok = localStorage.getItem(LS.cookieOk) === "1"; if(ok) return; const wrap = document.createElement("div"); wrap.className = "cookiebar"; wrap.innerHTML = ` <div class="box"> <p> We may store site preferences and () submissions locally in your browser. Embedded Facebook content may set its own cookies. <a href="./cookies.html" style="text-decoration:underline">Learn more</a>. </p> <div style="display:flex; gap:10px; flex-wrap:wrap;"> <a class="btn ghost" href="./cookies.html">Details</a> <button class="btn blue" id="cookieAccept" type="button">OK</button> </div> </div> `; document.body.appendChild(wrap); el("#cookieAccept", wrap).addEventListener("click", ()=>{ localStorage.setItem(LS.cookieOk, "1"); wrap.remove(); });
} /* Browse */
async function initBrowse(category){ await ensureSeed(); initDropdowns(); initCookieBar(); mountFooter(); if(!canUseLocalStorage()){ const warn = el("#storageWarn"); if(warn) warn.classList.remove("hidden"); } const approvedAll = getList(LS.approved, []).filter(p => p.platform==="facebook" && p.category===category); el("#countApproved").textContent = String(approvedAll.length); el("#countPending").textContent = String(getList(LS.pending, []).length); const grid = el("#postGrid"); const state = { q:"" }; function render(){ const q = state.q.trim().toLowerCase(); let list = approvedAll.slice(); if(q){ list = list.filter(p => (p.title||"").toLowerCase().includes(q) || (p.notes||"").toLowerCase().includes(q) || (p.fbUrl||"").toLowerCase().includes(q) || (p.tags||[]).join(" ").toLowerCase().includes(q) || ((p.submittedBy?.display)||"").toLowerCase().includes(q) ); } list.sort((a,b)=> (b.addedAt||"").localeCompare(a.addedAt||"")); grid.innerHTML = ""; if(!list.length){ grid.innerHTML = `<div class="notice">No posts yet. Use <b>Submit</b> → (Admin) <b>Review</b> → Approve.</div>`; return; } for(const p of list){ const tags = (p.tags||[]).slice(0, 10).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(""); const when = p.addedAt ? new Date(p.addedAt).toLocaleString() : ""; const iframeSrc = fbPluginSrc(p.fbUrl); const notes = p.notes ? `<div class="small" style="margin-top:10px">${escapeHtml(p.notes)}</div>` : ""; const card = document.createElement("div"); card.className = "card"; card.innerHTML = ` <div class="card-head"> <div class="title"> <h3>${escapeHtml(p.title || "Facebook Post")}</h3> <div class="meta">${escapeHtml(when)}</div> <div class="tags">${tags}</div> </div> <div> <a class="btn blue" href="${escapeHtml(p.fbUrl)}" target="_blank" rel="noopener">Open</a> </div> </div> <div class="card-body"> <div class="embed"> <iframe class="fbframe" src="${escapeHtml(iframeSrc)}" scrolling="no" allow="encrypted-media; picture-in-picture; clipboard-write"></iframe> </div> ${notes} <div class="card-foot"> ${formatSubmittedBy(p.submittedBy)} <span class="small">If embed is blocked, use <b>Open</b>.</span> </div> </div> `; grid.appendChild(card); } } const search = el("#search"); if(search) search.addEventListener("input", (e)=>{ state.q = e.target.value; render(); }); render();
} /* Submit */
async function initSubmit(){ await ensureSeed(); initDropdowns(); initCookieBar(); mountFooter(); if(!canUseLocalStorage()){ const warn = el("#storageWarn"); if(warn) warn.classList.remove("hidden"); } const form = el("#submitForm"); const out = el("#submitResult"); const preview = el("#previewBox"); const rawInput = el("#fbInput"); const titleInput = el("#title"); const max = window.CT_CONFIG.TITLE_MAX || 80; titleInput.setAttribute("maxlength", String(max)); const counter = el("#titleCount"); function updateCount(){ const left = max - (titleInput.value || "").length; counter.textContent = `${left} left`; } titleInput.addEventListener("input", updateCount); updateCount(); function setPreview(url){ if(!url){ preview.innerHTML = `<div class="notice">Paste a Facebook embed code (recommended) or URL to preview.</div>`; return; } const src = fbPluginSrc(url); preview.innerHTML = ` <div class="embed"> <iframe class="fbframe" src="${escapeHtml(src)}" scrolling="no" allow="encrypted-media; picture-in-picture; clipboard-write"></iframe> </div> `; } rawInput.addEventListener("input", ()=>{ const url = extractFacebookUrl(rawInput.value); setPreview(url); }); form.addEventListener("submit", (e)=>{ e.preventDefault(); out.textContent = ""; const url = extractFacebookUrl(rawInput.value); const category = el("#category").value; const title = titleInput.value.trim(); const notes = el("#notes").value.trim(); const tags = el("#tags").value.split(",").map(x=>x.trim()).filter(Boolean).slice(0, 20); const submitterNameRaw = el("#submitterName").value.trim(); const consent = el("#consentShowName").checked; let submittedBy = { display: "Anonymous" }; if(consent && submitterNameRaw){ const displayClean = submitterNameRaw.replace(/\s+/g, " ").slice(0, 40).replace(/^@/, ""); const submitterUrlRaw = el("#submitterUrl").value.trim(); let urlGuess = ""; if(submitterUrlRaw){ urlGuess = submitterUrlRaw; }else{ if(/^[a-z0-9.\-_]{3,}$/i.test(displayClean)){ urlGuess = `https://www.facebook.com/${displayClean}`; } } submittedBy = { display: `@${displayClean}`, url: urlGuess || "" }; } if(!url || !/facebook\.com/i.test(url)){ out.textContent = "Please paste a valid Facebook embed code or Facebook post URL."; out.className = "notice warn"; return; } const pending = await dbListPending(); pending.unshift({ id: uid("pending"), platform: "facebook", category, title: title || (category === "support" ? "Submitted (Support)" : "Submitted (MAGA / Debate)"), fbUrl: url, tags, notes, submittedBy, submittedAt: nowIso(), status: "pending" }); setList(LS.pending, pending); out.textContent = "Submitted for review. Thank you."; out.className = "notice good"; form.reset(); updateCount(); setPreview(""); }); setPreview("");
} /* Review (admin) */
async function initReview(){ await ensureSeed(); initDropdowns(); initCookieBar(); mountFooter(); if(!canUseLocalStorage()){ const warn = el("#storageWarn"); if(warn) warn.classList.remove("hidden"); } if(!isLoggedIn()){ window.location.href = "./index.html?next=review.html"; return; } const pendingWrap = el("#pendingList"); const approvedWrap = el("#approvedList"); function render(){ const pending = await dbListPending(); const approved = await dbListApproved(); el("#countPending").textContent = String(pending.length); el("#countApproved").textContent = String(approved.length); pendingWrap.innerHTML = ""; if(!pending.length){ pendingWrap.innerHTML = `<div class="notice">No pending submissions.</div>`; }else{ for(const p of pending){ const tags = (p.tags||[]).slice(0,10).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(""); const when = new Date(p.submittedAt || nowIso()).toLocaleString(); const card = document.createElement("div"); card.className = "card"; card.innerHTML = ` <div class="card-head"> <div class="title"> <h3>${escapeHtml(p.title || "Submission")}</h3> <div class="meta">${escapeHtml(p.category)} • submitted ${escapeHtml(when)}</div> <div class="tags">${tags}</div> </div> <div style="display:flex; gap:10px; flex-wrap:wrap;"> <a class="btn blue" href="${escapeHtml(p.fbUrl)}" target="_blank" rel="noopener">Open</a> <button class="btn blue" data-act="approve" data-id="${escapeHtml(p.id)}" type="button">Approve</button> <button class="btn ghost" data-act="reject" data-id="${escapeHtml(p.id)}" type="button">Reject</button> </div> </div> <div class="card-body"> <div class="embed"> <iframe class="fbframe" src="${escapeHtml(fbPluginSrc(p.fbUrl))}" scrolling="no" allow="encrypted-media; picture-in-picture; clipboard-write"></iframe> </div> ${p.notes ? `<div class="small" style="margin-top:10px">${escapeHtml(p.notes)}</div>` : ""} <div class="card-foot"> ${formatSubmittedBy(p.submittedBy)} <span class="small">Pending</span> </div> </div> `; pendingWrap.appendChild(card); } } approvedWrap.innerHTML = ""; const recent = approved.slice().sort((a,b)=> (b.addedAt||"").localeCompare(a.addedAt||"")).slice(0, 9); if(!recent.length){ approvedWrap.innerHTML = `<div class="notice">No approved posts yet.</div>`; }else{ for(const p of recent){ const when = p.addedAt ? new Date(p.addedAt).toLocaleString() : ""; const card = document.createElement("div"); card.className = "card"; card.innerHTML = ` <div class="card-head"> <div class="title"> <h3>${escapeHtml(p.title || "Approved Post")}</h3> <div class="meta">${escapeHtml(p.category)} • ${escapeHtml(when)}</div> </div> <div style="display:flex; gap:10px; flex-wrap:wrap;"> <a class="btn blue" href="${escapeHtml(p.fbUrl)}" target="_blank" rel="noopener">Open</a> <button class="btn ghost" data-act="remove" data-id="${escapeHtml(p.id)}" type="button">Remove</button> </div> </div> <div class="card-body"> <div class="card-foot"> ${formatSubmittedBy(p.submittedBy)} <span class="small">Approved</span> </div> </div> `; approvedWrap.appendChild(card); } } } pendingWrap.addEventListener("click", (e)=>{ const btn = e.target.closest("button[data-act]"); if(!btn) return; const act = btn.getAttribute("data-act"); const id = btn.getAttribute("data-id"); let pending = getList(LS.pending, []); let approved = getList(LS.approved, []); if(act === "approve"){ const idx = pending.findIndex(x => x.id === id); if(idx >= 0){ const item = pending[idx]; pending.splice(idx, 1); approved.unshift({ id: uid("post"), platform: "facebook", category: item.category, title: item.title, fbUrl: item.fbUrl, tags: item.tags || [], notes: item.notes || "", submittedBy: item.submittedBy || {display:"Anonymous"}, addedAt: nowIso() }); setList(LS.pending, pending); setList(LS.approved, approved); render(); } } if(act === "reject"){ pending = pending.filter(x => x.id !== id); setList(LS.pending, pending); render(); } }); approvedWrap.addEventListener("click", (e)=>{ const btn = e.target.closest("button[data-act]"); if(!btn) return; const act = btn.getAttribute("data-act"); const id = btn.getAttribute("data-id"); if(act === "remove"){ const approved = getList(LS.approved, []).filter(x => x.id !== id); setList(LS.approved, approved); render(); } }); el("#btnExportAll").addEventListener("click", ()=>{ const data = { version: 3, exportedAt: nowIso(), approved: getList(LS.approved, []), pending: getList(LS.pending, []) }; const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "civic-threat-dashboard-export.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }); const importInput = el("#importAllFile"); el("#btnImportAll").addEventListener("click", ()=> importInput.click()); importInput.addEventListener("change", async ()=>{ const file = importInput.files?.[0]; if(!file) return; try{ const text = await new Promise((resolve, reject)=>{ const fr = new FileReader(); fr.onload = ()=> resolve(fr.result); fr.onerror = reject; fr.readAsText(file); }); const obj = JSON.parse(text); if(Array.isArray(obj.approved)) setList(LS.approved, obj.approved); if(Array.isArray(obj.pending)) setList(LS.pending, obj.pending); render(); }catch{ alert("Import failed."); }finally{ importInput.value=""; } }); el("#btnClearPending").addEventListener("click", ()=>{ if(!confirm("Clear ALL pending submissions on this device?")) return; setList(LS.pending, []); render(); }); render();
} /* Admin Login */
async function initAdminLogin(){ initDropdowns(); initCookieBar(); mountFooter(); const next = new URLSearchParams(location.search).get("next") || "review.html"; const form = el("#loginForm"); const out = el("#loginResult"); form.addEventListener("submit", async (e)=>{ e.preventDefault(); out.textContent = ""; const u = el("#adminUser").value.trim(); const p = el("#adminPass").value; const ok = await login(u, p); if(ok){ location.href = "./" + next.replace(/^\/+/,""); }else{ out.textContent = "Invalid login."; out.className = "notice warn"; } });
} /* Home */
async function initHome(){ await ensureSeed(); await renderHomePreviews();
} async function renderHomePreviews(){ const approvedAll = await dbListApproved();
  const approved = (approvedAll||[]).filter(p => p.platform === "facebook"); const support = approved.filter(p => p.category === "support").sort((a,b)=> (b.addedAt||"").localeCompare(a.addedAt||"")).slice(0,3); const maga = approved.filter(p => p.category === "maga").sort((a,b)=> (b.addedAt||"").localeCompare(a.addedAt||"")).slice(0,3); function renderList(list, mountId){ const mount = el(mountId); if(!mount) return; mount.innerHTML = ""; if(!list.length){ mount.innerHTML = `<div class="notice">No approved posts yet.</div>`; return; } for(const p of list){ const iframeSrc = fbPluginSrc(p.fbUrl); const when = p.addedAt ? new Date(p.addedAt).toLocaleString() : ""; const card = document.createElement("div"); card.className = "card"; card.innerHTML = ` <div class="card-head"> <div class="title"> <h3>${escapeHtml(p.title || "Facebook Post")}</h3> <div class="meta">${escapeHtml(when)}</div> </div> <div> <a class="btn blue" href="${escapeHtml(p.fbUrl)}" target="_blank" rel="noopener">Open</a> </div> </div> <div class="card-body"> <div class="embed"> <iframe class="fbframe small" src="${escapeHtml(iframeSrc)}" scrolling="no" allow="encrypted-media; picture-in-picture; clipboard-write"></iframe> </div> <div class="card-foot"> ${formatSubmittedBy(p.submittedBy)} <span class="small">Preview</span> </div> </div> `; mount.appendChild(card); } } renderList(support, "#homeSupport"); renderList(maga, "#homeMaga");
} 
/* Data layer (local + optional remote) */
async function dbListApproved(){
  const cfg = window.CT_CONFIG.REMOTE_DB || {};
  if(cfg.enabled){
    try{
      const r = await window.CT_REMOTE.listApproved();
      return Array.isArray(r.items) ? r.items : (Array.isArray(r) ? r : []);
    }catch(e){
      console.warn("Remote approved failed, falling back:", e);
    }
  }
  return getList(LS.approved, []);
}

async function dbListPending(){
  const cfg = window.CT_CONFIG.REMOTE_DB || {};
  if(cfg.enabled){
    try{
      const r = await window.CT_REMOTE.listPending();
      return Array.isArray(r.items) ? r.items : (Array.isArray(r) ? r : []);
    }catch(e){
      console.warn("Remote pending failed, falling back:", e);
    }
  }
  return getList(LS.pending, []);
}

async function dbSubmit(item){
  const cfg = window.CT_CONFIG.REMOTE_DB || {};
  if(cfg.enabled){
    try{ return await window.CT_REMOTE.submit(item); }catch(e){ console.warn("Remote submit failed, falling back:", e); }
  }
  const pending = await dbListPending();
  // (handled by dbSubmit)

  setList(LS.pending, pending);
  return {ok:true};
}

async function dbApprove(id){
  const cfg = window.CT_CONFIG.REMOTE_DB || {};
  if(cfg.enabled){
    try{ return await window.CT_REMOTE.approve(id); }catch(e){ console.warn("Remote approve failed, falling back:", e); }
  }
  const pending = await dbListPending();
  const approved = await dbListApproved();
  const idx = pending.findIndex(p=>p.id===id);
  if(idx>=0){
    const [item] = pending.splice(idx,1);
    item.status="approved";
    approved.unshift(item);
    setList(LS.pending, pending);
    setList(LS.approved, approved);
  }
  return {ok:true};
}

async function dbReject(id){
  const cfg = window.CT_CONFIG.REMOTE_DB || {};
  if(cfg.enabled){
    try{ return await window.CT_REMOTE.reject(id); }catch(e){ console.warn("Remote reject failed, falling back:", e); }
  }
  const pending = await dbListPending();
  const filtered = pending.filter(p=>p.id!==id);
  setList(LS.pending, filtered);
  return {ok:true};
}


/* Router */
document.addEventListener("DOMContentLoaded", async ()=>{ // Always initialize core UI try{ initDropdowns(); }catch{} try{ initCookieBar(); }catch{} try{ mountFooter(); }catch{} const page = document.body.getAttribute("data-page"); if(page === "home") await initHome(); if(page === "fb_support") await initBrowse("support"); if(page === "fb_maga") await initBrowse("maga"); if(page === "submit") await initSubmit(); if(page === "review") await initReview(); if(page === "admin_login") await initAdminLogin(); });
