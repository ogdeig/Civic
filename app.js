/* CivicThreat.us — client app (Google Sheets remote-only) */
(function(){
  "use strict";

  const CFG = () => (window.CT_CONFIG || {});

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

  // ---------- DOM helpers ----------
  function qs(sel, root=document){ return root.querySelector(sel); }
  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function esc(s){ return (s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // ✅ FIX: Always use root-relative paths so links work from any folder (/released/... etc.)
  function basePath(){ return "/"; }

  // ---------- Remote API (required) ----------
  function remoteApi(){
    const cfg = CFG();
    if(!cfg.REMOTE_DB || cfg.REMOTE_DB.enabled !== true) {
      throw new Error("Remote DB is disabled. Set CT_CONFIG.REMOTE_DB.enabled=true in config.js");
    }
    if(!cfg.REMOTE_DB.appsScriptUrl){
      throw new Error("Remote DB URL missing. Set CT_CONFIG.REMOTE_DB.appsScriptUrl in config.js");
    }
    if(!window.CT_REMOTE){
      throw new Error("CT_REMOTE not found. Ensure data-api.js is loaded before app.js");
    }
    return window.CT_REMOTE;
  }

  async function listApproved(){ return await remoteApi().listApproved(); }
  async function listPending(){ return await remoteApi().listPending(); }
  async function submitItem(item){ return await remoteApi().submit(item); }
  async function approveItem(id){ return await remoteApi().approve(id); }
  async function rejectItem(id){ return await remoteApi().reject(id); }

  function uid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  // ---------- Header / Footer ----------
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
    qsa("a", menu).forEach(a=>a.addEventListener("click", close));
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
            <div class="brandblock">
              <a class="brand" href="${bp}index.html" aria-label="Home">
                <img src="${bp}assets/logo.png" alt="Civic Threat logo"/>
                <div class="text">
                  <strong>${esc(cfg.SITE_NAME || "CIVIC THREAT")}</strong>
                  <span>${esc(cfg.SITE_TAGLINE || "Debate & Discuss")}</span>
                </div>
              </a>

              <div class="socialblock" aria-label="Follow Civic Threat on social media">
                <div class="followcta" aria-hidden="true">
                  <span class="followtext">Follow us</span>
                  <span class="followarrow">➜</span>
                </div>
                <div class="iconrow" aria-label="Social links">
                  ${socialIcon("facebook")}
                  ${socialIcon("youtube")}
                  ${socialIcon("tiktok")}
                  ${socialIcon("x")}
                </div>
              </div>
            </div>

            <div class="nav">
              <div class="dropdown" id="platformsDD">
                <button class="btn" type="button" id="platformsBtn" aria-haspopup="true" aria-expanded="false">Platforms ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Platforms menu">
                  <div class="dd-title">Facebook</div>
                  <a class="dd-item" role="menuitem" href="${bp}facebook.html"><span>Support</span><small>Browse</small></a>
                  <a class="dd-item" role="menuitem" href="${bp}facebook-maga.html"><span>MAGA / Debate</span><small>Browse</small></a>
                </div>
              </div>

              <div class="dropdown" id="ReleasedsDD">
                <button class="btn" type="button" id="ReleasedsBtn" aria-haspopup="true" aria-expanded="false">Released Files ▾</button>
                <div class="dropdown-menu" role="menu" aria-label="Released files menu">
                  <a class="dd-item" role="menuitem" href="${bp}released/epstein/epstein-reader.html"><span>Epstein Files</span><small>PDF reader + audio</small></a>
                </div>
              </div>

              <a class="btn blue" href="${bp}submit.html">Submit</a>
            </div>
          </div>
        </div>
      </div>
    `;

    wireDropdown(qs("#platformsDD"));
    wireDropdown(qs("#ReleasedsDD"));
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

              <div class="followcta footer-cta" aria-hidden="true" style="margin-top:10px">
                <span class="followtext">Follow us</span>
                <span class="followarrow">➜</span>
              </div>

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

  // ---------- Cookie consent (cookie only) ----------
  function getCookie(name){
    const m = document.cookie.match(new RegExp("(^|;\\s*)" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function setCookie(name, value, days){
    const maxAge = days ? ("; Max-Age=" + String(days*24*60*60)) : "";
    document.cookie = name + "=" + encodeURIComponent(value) + maxAge + "; Path=/; SameSite=Lax";
  }

  function mountCookieBanner(){
    const pref = getCookie("ct_cookie_pref_v1");
    if(pref) return;

    const bp = basePath();
    const bar = document.createElement("div");
    bar.className = "cookiebar";
    bar.innerHTML = `
      <div class="box">
        <p>
          We use essential cookies to run the site and remember your preferences. Optional analytics/ads (if enabled later) may use cookies.
          <a href="${bp}cookies.html">Cookie Policy</a>
        </p>
        <div class="actions">
          <button class="btn" type="button" data-cookie="reject">Reject non-essential</button>
          <button class="btn blue" type="button" data-cookie="accept">Accept</button>
        </div>
      </div>
    `;
    document.body.appendChild(bar);

    qsa("button[data-cookie]", bar).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        setCookie("ct_cookie_pref_v1", btn.dataset.cookie, 365);
        bar.remove();
      });
    });
  }

  // ---------- Facebook embed parsing ----------
  function extractFacebookUrl(embedOrUrl){
    const raw = (embedOrUrl || "").trim();
    if(!raw) return "";
    if(/^https?:\/\/(www\.)?facebook\.com\//i.test(raw)) return raw;

    const hrefMatch = raw.match(/href=["']([^"']+)["']/i);
    if(hrefMatch && hrefMatch[1]){
      let h = hrefMatch[1];
      try{ h = decodeURIComponent(h); }catch{}
      if(/^https?:\/\/(www\.)?facebook\.com\//i.test(h)) return h;

      const hrefParam = h.match(/[?&]href=([^&]+)/);
      if(hrefParam){
        try{
          const u = decodeURIComponent(hrefParam[1]);
          if(/^https?:\/\/(www\.)?facebook\.com\//i.test(u)) return u;
        }catch{}
      }
    }

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

  function fbPluginSrc(postUrl, width){
    const href = encodeURIComponent(postUrl);
    const w = width || 500;
    return `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=${w}`;
  }

  function submitterLink(username){
    if(!username) return null;
    const u = username.trim().replace(/^@/,"");
    if(!u) return null;
    if(/^https?:\/\//i.test(u)) return u;
    return `https://www.facebook.com/${encodeURIComponent(u)}`;
  }

  function renderErrorBox(msg){
    return `<div class="smallnote" style="padding:14px; border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.25)">
      <strong style="display:block; margin-bottom:6px">Data loading error</strong>
      <div>${esc(msg)}</div>
      <div style="margin-top:8px; opacity:.8">Tip: verify config.js REMOTE_DB settings and Apps Script deployment.</div>
    </div>`;
  }

  // ---------- Lazy-loading Facebook embeds ----------
  function initLazyFacebookEmbeds(root=document){
    const shells = qsa(".fbembed-shell", root);
    if(!shells.length) return;

    const makeIframe = (shell) => {
      if(shell.dataset.loaded === "1") return;
      const url = shell.getAttribute("data-fb-url") || "";
      if(!url) return;

      const small = shell.classList.contains("small");
      const width = small ? 420 : 500;

      const iframe = document.createElement("iframe");
      iframe.className = "fbframe" + (small ? " small" : "");
      iframe.src = fbPluginSrc(url, width);
      iframe.loading = "lazy";
      iframe.setAttribute("allow", "encrypted-media");
      iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");

      shell.innerHTML = "";
      shell.appendChild(iframe);
      shell.dataset.loaded = "1";
    };

    if("IntersectionObserver" in window){
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if(entry.isIntersecting){
            makeIframe(entry.target);
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: "300px 0px" });

      shells.forEach(s => io.observe(s));
    } else {
      shells.forEach(makeIframe);
    }
  }

  function renderPostCard(item, opts={}){
    const small = opts.small === true;
    const tagText = item.category === "support" ? "Facebook • Support" : "Facebook • MAGA / Debate";
    const url = item.postUrl || "";

    const frame = url
      ? `
        <div class="fbembed-shell ${small ? "small":""}" data-fb-url="${esc(url)}">
          <div class="fbembed-loading">
            <div class="spinner"></div>
            <div class="txt">Loading post…</div>
          </div>
        </div>
      `
      : `<div class="smallnote">Missing Facebook URL.</div>`;

    const name = (item.submitterName || "Anonymous").trim() || "Anonymous";
    const link = (item.submitterLink || submitterLink(name));
    const by = link
      ? `<a class="submittedby" href="${link}" target="_blank" rel="noopener" title="Open submitter profile">Submitted by: ${esc(name)}</a>`
      : `<span class="submittedby">Submitted by: ${esc(name)}</span>`;

    const date = item.approvedAt ? new Date(Number(item.approvedAt)) : new Date(Number(item.submittedAt || Date.now()));
    const dateStr = date.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"2-digit"});

    const goTo = url
      ? `<a class="btn blue" href="${esc(url)}" target="_blank" rel="noopener">Go to Post</a>`
      : ``;

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
          <div class="post-actions">
            ${goTo}
            <a class="btn" href="${item.category === "support" ? "/facebook.html" : "/facebook-maga.html"}">Browse</a>
          </div>
        </div>
      </article>
    `;
  }

  // ---------- Page controllers ----------
  async function initHome(){
    const supportHost = qs("#homeSupport");
    const magaHost = qs("#homeMaga");

    if(supportHost) supportHost.innerHTML = `<div class="loadingline">Loading newest posts<span class="dots"></span></div>`;
    if(magaHost) magaHost.innerHTML = `<div class="loadingline">Loading newest posts<span class="dots"></span></div>`;

    try{
      const approved = (await listApproved()) || [];
      const support = approved.filter(x => x.platform === "facebook" && x.category === "support").slice(0,3);
      const maga = approved.filter(x => x.platform === "facebook" && x.category === "maga").slice(0,3);

      if(supportHost) supportHost.innerHTML = support.length
        ? support.map(x=>renderPostCard(x,{small:true})).join("")
        : `<div class="smallnote">No approved posts yet. <a href="/submit.html">Submit one</a>.</div>`;

      if(magaHost) magaHost.innerHTML = maga.length
        ? maga.map(x=>renderPostCard(x,{small:true})).join("")
        : `<div class="smallnote">No approved posts yet. <a href="/submit.html">Submit one</a>.</div>`;

      initLazyFacebookEmbeds(document);
    }catch(err){
      console.error(err);
      const msg = (err && err.message) ? err.message : String(err);
      if(supportHost) supportHost.innerHTML = renderErrorBox(msg);
      if(magaHost) magaHost.innerHTML = renderErrorBox(msg);
    }
  }

  async function initFeed(category){
    const grid = qs("#feedGrid");
    const countApproved = qs("#countApproved");
    const countPending = qs("#countPending");
    const input = qs("#search");

    if(grid) grid.innerHTML = `<div class="loadingline">Loading posts<span class="dots"></span></div>`;

    try{
      const approved = (await listApproved()) || [];
      const pending = (await listPending()) || [];

      const filtered = approved
        .filter(x => x.platform==="facebook" && x.category===category)
        .sort((a,b) => (Number(b.approvedAt)||0) - (Number(a.approvedAt)||0));

      if(countApproved) countApproved.textContent = String(filtered.length);
      if(countPending) countPending.textContent = String(pending.filter(x=>x.platform==="facebook" && x.category===category).length);

      function render(list){
        if(!grid) return;
        grid.innerHTML = list.length
          ? list.map(x=>renderPostCard(x)).join("")
          : `<div class="smallnote">Nothing here yet. <a href="/submit.html">Submit a post</a>.</div>`;
        initLazyFacebookEmbeds(grid);
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
    }catch(err){
      console.error(err);
      if(grid) grid.innerHTML = renderErrorBox((err && err.message) ? err.message : String(err));
      if(countApproved) countApproved.textContent = "0";
      if(countPending) countPending.textContent = "0";
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
        submitterLink: (consent && username) ? (submitterLink(username) || "") : "",
        consent
      };

      try{
        await submitItem(item);
        form.reset();
        if(status) status.textContent = "Submitted! Posts appear after review.";
      }catch(err){
        console.error(err);
        if(status) status.textContent = "Submit failed: " + ((err && err.message) ? err.message : String(err));
      }
    });
  }

  async function initAdmin(){
    const pendingHost = qs("#pendingList");
    const approvedHost = qs("#approvedList");

    function row(item, mode){
      const title = esc(item.title || "Untitled");
      const cat = item.category === "support" ? "Support" : "MAGA / Debate";
      const url = esc(item.postUrl || "");
      const by = esc((item.submitterName || "Anonymous").trim() || "Anonymous");
      const date = new Date(Number(item.submittedAt || Date.now())).toLocaleString();

      const buttons = mode === "pending"
        ? `<button class="btn blue" data-approve="${esc(item.id)}">Approve</button>
           <button class="btn" data-reject="${esc(item.id)}">Reject</button>`
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

    try{
      const pending = (await listPending()) || [];
      const approved = (await listApproved()) || [];

      if(pendingHost){
        const list = pending.filter(x=>x.platform==="facebook").sort((a,b)=>(Number(b.submittedAt)||0)-(Number(a.submittedAt)||0));
        pendingHost.innerHTML = list.length ? list.map(x=>row(x,"pending")).join("") : `<div class="smallnote">No pending submissions.</div>`;
      }
      if(approvedHost){
        const list = approved.filter(x=>x.platform==="facebook").sort((a,b)=>(Number(b.approvedAt)||0)-(Number(a.approvedAt)||0)).slice(0,50);
        approvedHost.innerHTML = list.length ? list.map(x=>row(x,"approved")).join("") : `<div class="smallnote">No approved posts yet.</div>`;
      }
    }catch(err){
      console.error(err);
      const msg = (err && err.message) ? err.message : String(err);
      if(pendingHost) pendingHost.innerHTML = renderErrorBox(msg);
      if(approvedHost) approvedHost.innerHTML = renderErrorBox(msg);
    }

    document.addEventListener("click", async (e)=>{
      const a = e.target.closest("[data-approve]");
      const r = e.target.closest("[data-reject]");
      if(a){
        const id = a.getAttribute("data-approve");
        a.textContent = "Approving…";
        try{
          await approveItem(id);
          location.reload();
        }catch(err){
          console.error(err);
          a.textContent = "Approve failed";
        }
      }
      if(r){
        const id = r.getAttribute("data-reject");
        r.textContent = "Rejecting…";
        try{
          await rejectItem(id);
          location.reload();
        }catch(err){
          console.error(err);
          r.textContent = "Reject failed";
        }
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
