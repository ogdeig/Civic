/* CivicThreat.us — client app (GitHub Pages friendly) */
(function(){
  "use strict";

  const CFG = () => (window.CT_CONFIG || {});
  const STORE = {
    approved: "ct_posts_approved_v1",
    pending:  "ct_posts_pending_v1",
    cookie:   "ct_cookie_pref_v1"
  };

  const SOCIAL = {
    facebook: "https://www.facebook.com/CivicThreat/",
    youtube:  "https://www.youtube.com/@civicthreat",
    tiktok:   "https://www.tiktok.com/@civicthreat",
    x:        "https://x.com/CivicThreat"
  };

  const ICONS = {
    facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-2.9h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2 .2 2 .2v2.2h-1.1c-1.1 0-1.5.7-1.5 1.4v1.7H16l-.4 2.9h-2.2v7A10 10 0 0 0 22 12z"/></svg>`,
    youtube:  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.7 31.7 0 0 0 2 12a31.7 31.7 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 22 12a31.7 31.7 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>`,
    tiktok:   `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 3c.5 2.7 2.3 4.8 5 5.2v3.2c-1.9 0-3.6-.6-5-1.7v6.2c0 3.1-2.5 5.6-5.6 5.6S5.4 19 5.4 15.9s2.5-5.6 5.6-5.6c.5 0 1 .1 1.4.2v3.2c-.4-.2-.9-.3-1.4-.3-1.3 0-2.3 1-2.3 2.3s1 2.3 2.3 2.3 2.3-1 2.3-2.3V3h3.3z"/></svg>`,
    x:       `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.9 7.9L23 22h-6.6l-5.2-6.7L5.4 22H2.3l7.4-8.5L1 2h6.8l4.7 6.1L18.9 2zm-1.1 18h1.7L6.1 3.9H4.3L17.8 20z"/></svg>`
  };
  // Remote API singleton (Google Sheets via Apps Script)
  let _remoteApi = null;
  function remoteApi(){
    const cfg = CFG();
    if(!cfg.REMOTE_DB?.enabled) return null;
    if(_remoteApi) return _remoteApi;

    // data-api.js may expose CT_REMOTE directly with listApproved/listPending/submit/approve/reject
    if(window.CT_REMOTE && typeof window.CT_REMOTE.listApproved === "function"){
      _remoteApi = window.CT_REMOTE;
      return _remoteApi;
    }

    // Or it may expose an init() that returns an API instance
    if(window.CT_REMOTE && typeof window.CT_REMOTE.init === "function"){
      _remoteApi = window.CT_REMOTE.init(cfg.REMOTE_DB);
      return _remoteApi;
    }

    return null;
  }



  function qs(sel, root=document){ return root.querySelector(sel); }
  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function esc(s){ return (s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function basePath(){
    // If hosted under /admin/, assets need ../
    return location.pathname.includes("/admin/") ? "../" : "./";
  }

  function mountHeader(){
    const host = qs("#siteHeader");
    if(!host) return;

    const cfg = CFG();
    const bp = basePath();

    host.innerHTML = `
      <div class="topbar">
        <div class="wrap">
          <div class="inner">
            <a class="brand" href="${bp}index.html" aria-label="Home">
              <img src="${bp}assets/logo.png" alt="Civic Threat logo"/>
              <div class="text">
                <strong>${esc(cfg.SITE_NAME || "CIVIC THREAT")}</strong>
                <span>${esc(cfg.SITE_TAGLINE || "Debate & Discuss")}</span>
              </div>
              <div class="iconrow" aria-label="Social links">
                ${socialIcon("facebook")}
                ${socialIcon("youtube")}
                ${socialIcon("tiktok")}
                ${socialIcon("x")}
              </div>
            </a>

            <div class="nav">
              <div class="dropdown" id="platformsDD">
                <button class="btn" type="button" id="platformsBtn" aria-haspopup="true" aria-expanded="false">Platforms ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Platforms menu">
                  <div class="dd-title">Facebook</div>
                  <a class="dd-item" role="menuitem" href="${bp}facebook.html"><span>Support</span><small>Browse</small></a>
                  <a class="dd-item" role="menuitem" href="${bp}facebook-maga.html"><span>MAGA / Debate</span><small>Browse</small></a>
                </div>
              </div>
              <a class="btn blue" href="${bp}submit.html">Submit</a>
            </div>
          </div>
        </div>
      </div>
    `;

    wireDropdown(qs("#platformsDD"));
  }

  function socialIcon(k){
    const url = SOCIAL[k];
    const label = ({facebook:"Facebook", youtube:"YouTube", tiktok:"TikTok", x:"X"})[k] || k;
    return `<a class="iconbtn" href="${url}" target="_blank" rel="noopener" aria-label="${label}">${ICONS[k]}</a>`;
  }

  function wireDropdown(dd){
    if(!dd) return;
    const btn = qs("button", dd);
    const menu = qs(".dropdown-menu", dd);
    function close(){
      dd.classList.remove("open");
      btn.setAttribute("aria-expanded","false");
    }
    function open(){
      dd.classList.add("open");
      btn.setAttribute("aria-expanded","true");
    }
    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      dd.classList.contains("open") ? close() : open();
    });
    document.addEventListener("click", (e)=>{
      if(!dd.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape") close();
    });
    // keep focus inside menu basic
    qsa("a", menu).forEach(a=>a.addEventListener("click", close));
  }

  function mountFooter(){
    const host = qs("#siteFooter");
    if(!host) return;

    const cfg = CFG();
    const bp = basePath();
    const year = cfg.COPYRIGHT_YEAR || new Date().getFullYear();

    host.innerHTML = `
      <footer class="site-footer">
        <div class="wrap">
          <div class="inner">
            <div>
              <div class="footer-brand">
                <img src="${bp}assets/logo.png" alt="Civic Threat logo"/>
                <div class="t">
                  <strong>${esc(cfg.SITE_NAME || "CIVIC THREAT")}</strong>
                  <span>${esc(cfg.SITE_TAGLINE || "Debate & Discuss")}</span>
                </div>
              </div>
              <div class="footer-copy">© ${year} Civic Threat. All rights reserved.</div>
              <div style="margin-top:10px" class="iconrow" aria-label="Social links in footer">
                ${socialIcon("facebook")}
                ${socialIcon("youtube")}
                ${socialIcon("tiktok")}
                ${socialIcon("x")}
              </div>
            </div>

            <div>
              <div class="footer-links">
                <a href="${bp}about.html">About</a>
                <a href="${bp}advertising-disclosure.html">Advertising Disclosure</a>
                <a href="${bp}privacy.html">Privacy</a>
                <a href="${bp}terms.html">Terms</a>
                <a href="${bp}cookies.html">Cookies</a>
                <a href="${bp}contact.html">Contact</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    `;
  }

  function mountCookieBanner(){
    // Minimal consent banner (no “prototype” language).
    if(localStorage.getItem(STORE.cookie)) return;

    const bp = basePath();
    const bar = document.createElement("div");
    bar.className = "cookiebar";
    bar.innerHTML = `
      <div class="box">
        <p>
          We use essential storage to run the site and remember your preferences. Optional analytics/ads (if enabled later) may use cookies.
          <a href="${bp}cookies.html">Cookie Policy</a>
        </p>
        <div class="actions">
          <button class="btn" type="button" data-cookie="reject">Reject non‑essential</button>
          <button class="btn blue" type="button" data-cookie="accept">Accept</button>
        </div>
      </div>
    `;
    document.body.appendChild(bar);

    qsa("button[data-cookie]", bar).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        localStorage.setItem(STORE.cookie, btn.dataset.cookie);
        bar.remove();
      });
    });
  }

  // ---------- Data layer ----------
  function lsGet(key, fallback){
    try{
      const v = JSON.parse(localStorage.getItem(key) || "null");
      return v ?? fallback;
    }catch{ return fallback; }
  }
  function lsSet(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }
  function uid(){
    if(crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  async function listApproved(){
    const cfg = CFG();
    if(cfg.REMOTE_DB?.enabled){
      try{ const api = remoteApi(); if(!api) throw new Error('Remote API not initialized'); return await api.listApproved(); }catch(e){ console.warn(e); }
    }
    return lsGet(STORE.approved, []);
  }
  async function listPending(){
    const cfg = CFG();
    if(cfg.REMOTE_DB?.enabled){
      try{ const api = remoteApi(); if(!api) throw new Error('Remote API not initialized'); return await api.listPending(); }catch(e){ console.warn(e); }
    }
    return lsGet(STORE.pending, []);
  }
  async function submitItem(item){
    const cfg = CFG();
    if(cfg.REMOTE_DB?.enabled){
      try{ const api = remoteApi(); if(!api) throw new Error('Remote API not initialized'); return await api.submit(item); }catch(e){ console.warn(e); }
    }
    const pending = lsGet(STORE.pending, []);
    pending.unshift(item);
    lsSet(STORE.pending, pending);
    return { ok:true };
  }
  async function approveItem(id){
    const cfg = CFG();
    if(cfg.REMOTE_DB?.enabled){
      try{ const api = remoteApi(); if(!api) throw new Error('Remote API not initialized'); return await api.approve(id); }catch(e){ console.warn(e); }
    }
    const pending = lsGet(STORE.pending, []);
    const approved = lsGet(STORE.approved, []);
    const idx = pending.findIndex(x => x.id === id);
    if(idx >= 0){
      const item = pending.splice(idx,1)[0];
      item.approvedAt = Date.now();
      approved.unshift(item);
      lsSet(STORE.pending, pending);
      lsSet(STORE.approved, approved);
    }
    return { ok:true };
  }
  async function rejectItem(id){
    const cfg = CFG();
    if(cfg.REMOTE_DB?.enabled){
      try{ const api = remoteApi(); if(!api) throw new Error('Remote API not initialized'); return await api.reject(id); }catch(e){ console.warn(e); }
    }
    const pending = lsGet(STORE.pending, []);
    lsSet(STORE.pending, pending.filter(x => x.id !== id));
    return { ok:true };
  }

  // seed helper (optional)
  async function ensureSeed(){
    const approved = lsGet(STORE.approved, []);
    const pending = lsGet(STORE.pending, []);
    if(approved.length || pending.length) return;

    try{
      const bp = basePath();
      const res = await fetch(bp + "data/seed.json", {cache:"no-store"});
      if(res.ok){
        const data = await res.json();
        if(Array.isArray(data) && data.length){
          lsSet(STORE.approved, data);
        }
      }
    }catch(e){ /* ignore */ }
  }

  // ---------- Facebook embed parsing ----------
  function extractFacebookUrl(embedOrUrl){
    const raw = (embedOrUrl || "").trim();
    if(!raw) return "";

    // If direct URL pasted, keep it.
    if(/^https?:\/\/(www\.)?facebook\.com\//i.test(raw)) return raw;

    // Try data-href="..."
    const dataHref = raw.match(/data-href=["']([^"']+)["']/i);
    if(dataHref && dataHref[1]){
      const u = dataHref[1].trim();
      if(/^https?:\/\/(www\.)?facebook\.com\//i.test(u)) return u;
    }

    // Try any facebook.com URL inside the snippet
    const anyUrl = raw.match(/https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9._\-\/\?=&%]+/i);
    if(anyUrl && anyUrl[0]) return anyUrl[0];

    // Try href="..."
    const hrefMatch = raw.match(/href=["']([^"']+)["']/i);
    if(hrefMatch && hrefMatch[1]){
      let h = hrefMatch[1];
      try{ h = decodeURIComponent(h); }catch{}
      if(/^https?:\/\/(www\.)?facebook\.com\//i.test(h)) return h;
      const hrefParam = h.match(/[?&]href=([^&]+)/);
      if(hrefParam) {
        try{
          const u = decodeURIComponent(hrefParam[1]);
          if(/^https?:\/\/(www\.)?facebook\.com\//i.test(u)) return u;
        }catch{}
      }
    }

    // Try iframe src with href param
    const srcMatch = raw.match(/src=["']([^"']+)["']/i);
    if(srcMatch && srcMatch[1]){
      const s = srcMatch[1];
      const hrefParam = s.match(/[?&]href=([^&]+)/);
      if(hrefParam){
        try{
          const u = decodeURIComponent(hrefParam[1]);
          if(/^https?:\/\/(www\.)?facebook\.com\//i.test(u)) return u;
        }catch{}
      }
    }
    return "";
  }

  function fbPluginSrc(postUrl){
    const href = encodeURIComponent(postUrl);
    return `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=500`;
  }

  function submitterLink(username){
    if(!username) return null;
    const u = username.trim().replace(/^@/,"");
    if(!u) return null;
    if(/^https?:\/\//i.test(u)) return u;
    // Facebook profile/page slug
    return `https://www.facebook.com/${encodeURIComponent(u)}`;
  }

  function renderPostCard(item, opts={}){
    const small = opts.small === true;
    const tagText = item.category === "support" ? "Facebook • Support" : "Facebook • MAGA / Debate";
    const url = item.postUrl || "";
    const frame = url ? `<iframe class="fbframe ${small ? "small":""}" src="${fbPluginSrc(url)}" loading="lazy" allow="encrypted-media"></iframe>`
                      : `<div class="smallnote">Missing Facebook URL.</div>`;

    const name = (item.submitterName || "Anonymous").trim() || "Anonymous";
    const link = (item.submitterLink || submitterLink(name));
    const by = link
      ? `<a class="submittedby" href="${link}" target="_blank" rel="noopener" title="Open submitter profile">Submitted by: ${esc(name)}</a>`
      : `<span class="submittedby">Submitted by: ${esc(name)}</span>`;

    const date = new Date(item.submittedAt || Date.now());
    const dateStr = date.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"2-digit"});

    const goBtn = url
      ? `<a class="btn blue" href="${url}" target="_blank" rel="noopener">Go to post</a>`
      : `<span class="btn blue disabled" title="Post link unavailable">Go to post</span>`;

    return `
      <article class="post-card">
        <div class="post-head">
          <div class="post-title">
            <h3>${esc(item.title || "Untitled")}</h3>
            <div class="meta">${esc(tagText)} • ${esc(dateStr)}</div>
          </div>
          <div class="tagrow"><span class="tag">${esc(item.platform || "facebook")}</span></div>
        </div>
        <div class="embed">${frame}</div>
        <div class="post-foot">
          ${by}
          <div class="btngroup">
            ${goBtn}
            <a class="btn" href="${item.category === "support" ? "./facebook.html" : "./facebook-maga.html"}">Browse</a>
          </div>
        </div>
      </article>
    `;
  }

  // ---------- Page controllers ----------
  async function initHome(){
    await ensureSeed();
    const approved = (await listApproved()) || [];
    const support = approved.filter(x => x.platform === "facebook" && x.category === "support").slice(0,3);
    const maga = approved.filter(x => x.platform === "facebook" && x.category === "maga").slice(0,3);

    const supportHost = qs("#homeSupport");
    const magaHost = qs("#homeMaga");
    if(supportHost) supportHost.innerHTML = support.length ? support.map(x=>renderPostCard(x,{small:true})).join("") : `<div class="smallnote">No approved posts yet. <a href="./submit.html">Submit one</a>.</div>`;
    if(magaHost) magaHost.innerHTML = maga.length ? maga.map(x=>renderPostCard(x,{small:true})).join("") : `<div class="smallnote">No approved posts yet. <a href="./submit.html">Submit one</a>.</div>`;
  }

  async function initFeed(category){
    await ensureSeed();
    const approved = (await listApproved()) || [];
    const pending = (await listPending()) || [];

    const filtered = approved.filter(x => x.platform==="facebook" && x.category===category)
      .sort((a,b) => (b.approvedAt||0) - (a.approvedAt||0));

    const grid = qs("#feedGrid");
    const countApproved = qs("#countApproved");
    const countPending = qs("#countPending");
    if(countApproved) countApproved.textContent = String(filtered.length);
    if(countPending) countPending.textContent = String(pending.filter(x=>x.platform==="facebook" && x.category===category).length);

    const input = qs("#search");
    function render(list){
      if(!grid) return;
      grid.innerHTML = list.length ? list.map(x=>renderPostCard(x)).join("") : `<div class="smallnote">Nothing here yet. <a href="./submit.html">Submit a post</a>.</div>`;
    }

    render(filtered);

    if(input){
      input.addEventListener("input", ()=>{
        const q = input.value.trim().toLowerCase();
        if(!q){ render(filtered); return; }
        const s = filtered.filter(x =>
          (x.title||"").toLowerCase().includes(q) ||
          (x.postUrl||"").toLowerCase().includes(q) ||
          (x.submitterName||"").toLowerCase().includes(q)
        );
        render(s);
      });
    }
  }

  async function initSubmit(){
    const form = qs("#submitForm");
    const status = qs("#submitStatus");
    if(!form) return;

    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if(status) status.textContent = "";

      const title = (qs("#title")?.value || "").trim();
      const category = qs("#category")?.value || "support";
      const embed = (qs("#embed")?.value || "").trim();
      const username = (qs("#username")?.value || "").trim();
      const consent = qs("#consent")?.checked === true;

      const cfg = CFG();
      const max = cfg.TITLE_MAX || 80;
      if(!title){ if(status) status.textContent = "Please enter a title."; return; }
      if(title.length > max){ if(status) status.textContent = `Title must be ${max} characters or less.`; return; }

      const postUrl = extractFacebookUrl(embed);
      if(!postUrl){
        if(status) status.textContent = "Please paste the Facebook embed code (or a direct Facebook post URL).";
        return;
      }

      const item = {
        id: uid(),
        platform: "facebook",
        category,
        title,
        postUrl,
        submittedAt: Date.now(),
        submitterName: (consent && username) ? username : "Anonymous",
        submitterLink: (consent && username) ? submitterLink(username) : "",
        consent
      };

      try{
        await submitItem(item);
        form.reset();
        if(status) status.textContent = "Submitted! Posts appear after review.";
      }catch(err){
        console.error(err);
        if(status) status.textContent = "Submit failed. Please try again.";
      }
    });
  }

  async function initAdmin(){
    await ensureSeed();
    const pending = (await listPending()) || [];
    const approved = (await listApproved()) || [];

    const pendingHost = qs("#pendingList");
    const approvedHost = qs("#approvedList");

    function row(item, mode){
      const title = esc(item.title || "Untitled");
      const cat = item.category === "support" ? "Support" : "MAGA / Debate";
      const url = esc(item.postUrl || "");
      const by = esc((item.submitterName || "Anonymous").trim() || "Anonymous");
      const date = new Date(item.submittedAt || Date.now()).toLocaleString();
      const buttons = mode === "pending"
        ? `<button class="btn blue" data-approve="${item.id}">Approve</button>
           <button class="btn" data-reject="${item.id}">Reject</button>`
        : ``;

      return `
        <div class="post-card" style="padding:12px; display:flex; flex-direction:column; gap:10px">
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap">
            <div>
              <div style="font-weight:1000">${title}</div>
              <div class="smallnote">Facebook • ${esc(cat)} • Submitted by ${by} • ${esc(date)}</div>
              <div class="smallnote"><a href="${url}" target="_blank" rel="noopener">${url}</a></div>
            </div>
            <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap">
              ${buttons}
            </div>
          </div>
        </div>
      `;
    }

    if(pendingHost){
      const list = pending.filter(x=>x.platform==="facebook").sort((a,b)=>(b.submittedAt||0)-(a.submittedAt||0));
      pendingHost.innerHTML = list.length ? list.map(x=>row(x,"pending")).join("") : `<div class="smallnote">No pending submissions.</div>`;
    }
    if(approvedHost){
      const list = approved.filter(x=>x.platform==="facebook").sort((a,b)=>(b.approvedAt||0)-(a.approvedAt||0)).slice(0,50);
      approvedHost.innerHTML = list.length ? list.map(x=>row(x,"approved")).join("") : `<div class="smallnote">No approved posts yet.</div>`;
    }

    document.addEventListener("click", async (e)=>{
      const a = e.target.closest("[data-approve]");
      const r = e.target.closest("[data-reject]");
      if(a){
        const id = a.getAttribute("data-approve");
        a.textContent = "Approving…";
        await approveItem(id);
        location.reload();
      }
      if(r){
        const id = r.getAttribute("data-reject");
        r.textContent = "Rejecting…";
        await rejectItem(id);
        location.reload();
      }
    });
  }

  function init(){
    mountHeader();
    mountFooter();
    mountCookieBanner();

    const page = document.body?.dataset?.page || "";
    if(page === "home") return initHome();
    if(page === "fb_support") return initFeed("support");
    if(page === "fb_maga") return initFeed("maga");
    if(page === "submit") return initSubmit();
    if(page === "admin") return initAdmin();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
