
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
  const bp = basePath();
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
        <a class="iconbtn" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-2.9h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2 .2 2 .2v2.2h-1.1c-1.1 0-1.5.7-1.5 1.4v1.7H16l-.4 2.9h-2.2v7A10 10 0 0 0 22 12z"/></svg></a>
        <a class="iconbtn" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.7 31.7 0 0 0 2 12a31.7 31.7 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 22 12a31.7 31.7 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg></a>
        <a class="iconbtn" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 3c.5 2.7 2.3 4.8 5 5.2v3.2c-1.9 0-3.6-.6-5-1.7v6.2c0 3.1-2.5 5.6-5.6 5.6S5.4 19 5.4 15.9s2.5-5.6 5.6-5.6c.5 0 1 .1 1.4.2v3.2c-.4-.2-.9-.3-1.4-.3-1.3 0-2.3 1-2.3 2.3s1 2.3 2.3 2.3 2.3-1 2.3-2.3V3h3.3z"/></svg></a>
        <a class="iconbtn" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.9 7.9L23 22h-6.6l-5.2-6.7L5.4 22H2.3l7.4-8.5L1 2h6.8l4.7 6.1L18.9 2zm-1.1 18h1.7L6.1 3.9H4.3L17.8 20z"/></svg></a>
      </div>
    </div>
  `;
  document.body.appendChild(el);
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
