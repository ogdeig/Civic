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
  const isSmall = !!opts.small;

  const title = esc(item.title || "Untitled");
  const date = esc(item.createdAt || "");
  const categoryLabel = item.category === "support" ? "Facebook • Support" : "Facebook • MAGA / Debate";

  const allowName = !!item.allowUsername;
  const submittedBy = allowName ? (item.submittedBy || "Anonymous") : "Anonymous";

  const by = `<span class="pill">Submitted by: @${esc(submittedBy)}</span>`;

  const norm = normalizeFacebookEmbed(item.embedHtml, { small: isSmall, width: 500 });
  const url = norm.url;

  return `
    <article class="post-card">
      <div class="post-head">
        <div>
          <div class="post-title">${title}</div>
          <div class="post-meta">${categoryLabel} • ${date}</div>
        </div>
        <span class="tag">facebook</span>
      </div>

      <div class="post-embed">${norm.html}</div>

      <div class="post-foot">
        ${by}
        <div class="btngroup">
          ${url ? `<a class="btn red" href="${url}" target="_blank" rel="noopener">Go to post</a>` : ``}
          <a class="btn ghost" href="${item.category === "support" ? "./facebook.html" : "./facebook-maga.html"}">Browse</a>
        </div>
      </div>
    </article>
  `;
}


function extractFacebookUrlFromEmbed(embedHtml){
  if(!embedHtml) return "";
  const s = String(embedHtml);

  // data-href on fb-post
  let m = s.match(/data-href=[\"']([^\"']+)[\"']/i);
  if(m && m[1]) return m[1].trim();

  // plugin src with href=...
  m = s.match(/href=([^&\"']+)/i);
  if(m && m[1]){
    try{ return decodeURIComponent(m[1]); }catch(e){ return m[1]; }
  }

  // any facebook URL inside snippet
  m = s.match(/https?:\/\/www\.facebook\.com\/[\w\W]*?(?=[\s\"'<])/i);
  if(m && m[0]) return m[0];

  return "";
}

function normalizeFacebookEmbed(embedHtml, opts={}){
  const url = extractFacebookUrlFromEmbed(embedHtml);
  const width = opts.width || 500;
  const small = !!opts.small;

  // Build a clean iframe (avoids FB JS SDK errors)
  if(url){
    const src = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true&width=${width}`;
    return {
      url,
      html: `<iframe class="fbframe ${small ? "small" : ""}" src="${src}" width="${width}" height="${small ? 260 : 360}" style="border:none;overflow:hidden" scrolling="no" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen="true"></iframe>`
    };
  }

  // Fallback: strip scripts to prevent JS errors
  const cleaned = String(embedHtml || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<div[^>]*id=[\"']fb-root[\"'][^>]*>[\s\S]*?<\/div>/gi, "");
  return { url:"", html: cleaned };
}

)();
