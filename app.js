/* global window, document, location */
(function(){
  "use strict";

  // Build root-relative links so navigation works from ANY subfolder page.
  // (Example: from /released/epstein/... we still want /released/epstein/..., not ./released/epstein/...)
  function r(path){
    const p = String(path || "").trim();
    if(!p) return "/";
    return p.startsWith("/") ? p : ("/" + p.replace(/^\/+/, ""));
  }

  function CFG(){
    return window.CT_CONFIG || {};
  }

  function qs(sel, root=document){
    return root.querySelector(sel);
  }
  function qsa(sel, root=document){
    return Array.from(root.querySelectorAll(sel));
  }

  function esc(s){
    return String(s || "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function mountHeader(){
    const host = qs("#siteHeader");
    if(!host) return;

    const cfg = CFG();
    const homeHref = r("index.html");
    const logoSrc = r("assets/logo.png");

    host.innerHTML = `
      <header class="site-header">
        <div class="wrap header-row">
          <div class="left">
            <a class="brand" href="${homeHref}" aria-label="Home">
              <img src="${logoSrc}" alt="Civic Threat logo"/>
              <div class="brand-text">
                <div class="brand-name">${esc(cfg.SITE_NAME || "CIVIC THREAT")}</div>
                <div class="brand-tag">${esc(cfg.SITE_TAGLINE || "")}</div>
              </div>
            </a>

            <div class="follow">
              <span>FOLLOW US</span>
              <a class="icon" href="${esc(cfg.SOCIAL?.facebook || "#")}" target="_blank" rel="noopener" aria-label="Facebook">f</a>
              <a class="icon" href="${esc(cfg.SOCIAL?.youtube  || "#")}" target="_blank" rel="noopener" aria-label="YouTube">▶</a>
              <a class="icon" href="${esc(cfg.SOCIAL?.tiktok   || "#")}" target="_blank" rel="noopener" aria-label="TikTok">♪</a>
              <a class="icon" href="${esc(cfg.SOCIAL?.x       || "#")}" target="_blank" rel="noopener" aria-label="X">X</a>
            </div>
          </div>

          <nav class="nav">
            <div class="dd">
              <button class="dd-btn" type="button" data-dd="platforms">Platforms ▾</button>
              <div class="dd-menu" data-dd-menu="platforms" role="menu">
                <a class="dd-item" role="menuitem" href="${r("facebook.html")}"><span>Facebook • Support</span><small>Browse</small></a>
                <a class="dd-item" role="menuitem" href="${r("facebook-maga.html")}"><span>Facebook • MAGA / Debate</span><small>Browse</small></a>
              </div>
            </div>

            <div class="dd">
              <button class="dd-btn" type="button" data-dd="released">Released Files ▾</button>
              <div class="dd-menu" data-dd-menu="released" role="menu">
                <a class="dd-item" role="menuitem" href="${r("released/epstein/epstein-reader.html")}"><span>Epstein Files</span><small>PDF reader + audio</small></a>
              </div>
            </div>

            <a class="btn blue" href="${r("submit.html")}">Submit</a>
          </nav>
        </div>
      </header>
    `;

    // Dropdown toggles
    host.addEventListener("click", (e)=>{
      const btn = e.target.closest?.(".dd-btn");
      if(!btn) return;
      const key = btn.getAttribute("data-dd");
      if(!key) return;

      const menu = host.querySelector(`[data-dd-menu="${CSS.escape(key)}"]`);
      if(!menu) return;

      // close others
      qsa(".dd-menu", host).forEach(m=>{
        if(m !== menu) m.classList.remove("open");
      });
      menu.classList.toggle("open");
    });

    document.addEventListener("click", (e)=>{
      if(e.target.closest?.(".dd")) return;
      qsa(".dd-menu", host).forEach(m=>m.classList.remove("open"));
    });
  }

  function mountFooter(){
    const host = qs("#siteFooter");
    if(!host) return;

    const cfg = CFG();
    const logoSrc = r("assets/logo.png");
    const year = cfg.COPYRIGHT_YEAR || new Date().getFullYear();

    host.innerHTML = `
      <footer class="site-footer">
        <div class="wrap footer-row">
          <div class="footer-brand">
            <img src="${logoSrc}" alt="Civic Threat logo"/>
            <div>
              <div class="footer-name">${esc(cfg.SITE_NAME || "CIVIC THREAT")}</div>
              <div class="footer-copy">© ${year} Civic Threat. All rights reserved.</div>
            </div>
          </div>

          <div class="footer-links">
            <a href="${r("about.html")}">About</a>
            <a href="${r("contact.html")}">Contact</a>
            <a href="${r("privacy.html")}">Privacy</a>
            <a href="${r("terms.html")}">Terms</a>
            <a href="${r("cookies.html")}">Cookies</a>
          </div>
        </div>
      </footer>
    `;
  }

  function mountCookieBanner(){
    if(localStorage.getItem("ct_cookies_ok") === "1") return;

    const cookieHref = r("cookies.html");

    const wrap = document.createElement("div");
    wrap.className = "cookie-banner";
    wrap.innerHTML = `
      <div class="cookie-inner">
        <div class="cookie-text">
          We use cookies and local storage to improve site functionality and measure usage.
          <a href="${cookieHref}">Cookie Policy</a>
        </div>
        <button class="btn" type="button" id="cookieOk">OK</button>
      </div>
    `;
    document.body.appendChild(wrap);

    qs("#cookieOk", wrap)?.addEventListener("click", ()=>{
      localStorage.setItem("ct_cookies_ok", "1");
      wrap.remove();
    });
  }

  // --------- Facebook embed helpers ---------
  function renderFacebookEmbed(url){
    const u = String(url || "").trim();
    if(!u) return `<div class="fbembed-loading"><div class="dots">…</div><div>Missing post URL</div></div>`;

    // Use a simple iframe embed so we don't need the FB SDK (lighter + more reliable)
    const src = "https://www.facebook.com/plugins/post.php?href=" + encodeURIComponent(u) + "&show_text=true&width=500";
    return `
      <iframe
        class="fb-iframe"
        src="${src}"
        width="500"
        height="640"
        style="border:none;overflow:hidden"
        scrolling="no"
        frameborder="0"
        allow="encrypted-media; clipboard-write"
        allowfullscreen="true">
      </iframe>
    `;
  }

  function initLazyFacebookEmbeds(root=document){
    const nodes = qsa("[data-fburl]", root);
    nodes.forEach(n=>{
      if(n.__fb_done) return;
      n.__fb_done = true;
      const url = n.getAttribute("data-fburl");
      n.innerHTML = renderFacebookEmbed(url);
    });
  }

  // ---------- Reactions (❤️ on Support, 🖕 on MAGA) ----------
  let __reactionsWired = false;
  function wireReactions(){
    if(__reactionsWired) return;
    __reactionsWired = true;

    const COOLDOWN_MS = 5000;
    const KEY_NEXT = "ct_react_next_allowed";

    document.addEventListener("click", async (e)=>{
      const btn = e.target?.closest?.(".reactbtn");
      if(!btn) return;
      if(btn.disabled) return;

      const id = btn.getAttribute("data-id");
      const dir = btn.getAttribute("data-dir"); // "up" | "down"
      if(!id || !dir) return;

      // global per-browser cooldown
      const now = Date.now();
      const nextAllowed = Number(localStorage.getItem(KEY_NEXT) || "0");
      if(now < nextAllowed){
        btn.classList.add("shake");
        setTimeout(()=>btn.classList.remove("shake"), 400);

        const note = btn.closest(".reactbar")?.querySelector(".reactnote");
        if(note){
          const secs = Math.max(1, Math.ceil((nextAllowed - now)/1000));
          note.textContent = `Cooldown: ${secs}s`;
          setTimeout(()=>{ if(note) note.textContent = ""; }, 1200);
        }
        return;
      }

      localStorage.setItem(KEY_NEXT, String(now + COOLDOWN_MS));

      const countSpan = btn.querySelector(".reactcount");
      const current = Number(countSpan?.textContent || "0");

      // optimistic update
      if(countSpan) countSpan.textContent = String(current + 1);
      btn.disabled = true;

      try {
        if(!window.CT_REMOTE || typeof window.CT_REMOTE.react !== "function"){
          throw new Error("Reactions backend not configured (CT_REMOTE.react missing).");
        }

        const res = await window.CT_REMOTE.react(id, dir);
        if(res && res.ok === false) throw new Error(res.error || "Reaction failed");

        // If backend returns updated item counts, snap to truth
        if(res && res.item){
          const newCount = dir === "up"
            ? Number(res.item.reactionsUp || 0)
            : Number(res.item.reactionsDown || 0);
          if(countSpan) countSpan.textContent = String(newCount);
        }
      } catch (err){
        console.error(err);
        // rollback
        if(countSpan) countSpan.textContent = String(current);
      } finally {
        // keep the button disabled for the cooldown window
        setTimeout(()=>{ btn.disabled = false; }, COOLDOWN_MS);
      }
    });
  }

  // --------- Rendering ---------
  function fmtDate(ts){
    const n = Number(ts || 0);
    if(!n) return "";
    const d = new Date(n);
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }

  function renderPostCard(item, opts={}){
    const small = opts.small === true;
    const tagText = item.category === "support" ? "Facebook • Support" : "Facebook • MAGA / Debate";
    const url = item.postUrl || "";

    // Reactions (Support: ❤️, MAGA: 🖕)
    const isSupport = item.category === "support";
    const reactEmoji = isSupport ? "❤️" : "🖕";
    const reactDir = isSupport ? "up" : "down";
    const reactCount = isSupport ? Number(item.reactionsUp || 0) : Number(item.reactionsDown || 0);
    const canReact = !!(CFG().REMOTE_DB && CFG().REMOTE_DB.enabled && window.CT_REMOTE && typeof window.CT_REMOTE.react === "function");

    const browseHref = isSupport ? r("facebook.html") : r("facebook-maga.html");

    return `
      <article class="post-card ${small ? "small" : ""}">
        <div class="post-head">
          <div class="tag">${esc(tagText)}</div>
          <div class="meta">
            ${item.title ? `<div class="title">${esc(item.title)}</div>` : ""}
            <div class="sub">${esc(item.submitterName || "Anonymous")}${item.approvedAt ? ` • ${esc(fmtDate(item.approvedAt))}` : ""}</div>
          </div>
        </div>

        <div class="embed-wrap" data-fburl="${esc(url)}">
          <div class="fbembed-loading"><div class="dots">…</div><div>Loading…</div></div>
        </div>

        <div class="reactbar">
          <button
            class="reactbtn"
            type="button"
            data-id="${esc(item.id || "")}"
            data-dir="${esc(reactDir)}"
            ${(!canReact || !item.id) ? "disabled" : ""}
            aria-label="React">
            ${reactEmoji} <span class="reactcount">${reactCount}</span>
          </button>
          <div class="reactnote"></div>
        </div>

        <div class="post-foot">
          <a class="mini" href="${esc(url)}" target="_blank" rel="noopener">Open on Facebook</a>
          <a class="mini" href="${browseHref}">Browse all</a>
        </div>
      </article>
    `;
  }

  async function listApproved(category){
    if(window.CT_REMOTE && typeof window.CT_REMOTE.listApproved === "function"){
      const all = await window.CT_REMOTE.listApproved();
      return (all || []).filter(x => x.platform === "facebook" && x.category === category);
    }
    return [];
  }

  async function loadHome(){
    // Home page feeds
    const supportHost = qs("#homeSupport");
    const magaHost = qs("#homeMaga");

    if(supportHost){
      supportHost.innerHTML = `<div class="smallnote">Loading…</div>`;
      const items = await listApproved("support");
      supportHost.innerHTML = (items || []).slice(0,6).map(i=>renderPostCard(i,{small:true})).join("") ||
        `<div class="smallnote">No approved posts yet. <a href="${r("submit.html")}">Submit one</a>.</div>`;
      initLazyFacebookEmbeds(supportHost);
    }

    if(magaHost){
      magaHost.innerHTML = `<div class="smallnote">Loading…</div>`;
      const items = await listApproved("maga");
      magaHost.innerHTML = (items || []).slice(0,6).map(i=>renderPostCard(i,{small:true})).join("") ||
        `<div class="smallnote">No approved posts yet. <a href="${r("submit.html")}">Submit one</a>.</div>`;
      initLazyFacebookEmbeds(magaHost);
    }
  }

  async function loadFeedPage(category){
    const grid = qs("#feedGrid");
    if(!grid) return;

    grid.innerHTML = `<div class="smallnote">Loading…</div>`;
    const items = await listApproved(category);

    grid.innerHTML = (items || []).map(i=>renderPostCard(i,{small:false})).join("") ||
      `<div class="smallnote">No posts yet.</div>`;

    initLazyFacebookEmbeds(grid);
  }

  function initRouter(){
    const page = document.body.getAttribute("data-page");
    if(page === "home") return loadHome();
    if(page === "facebook") return loadFeedPage("support");
    if(page === "facebook-maga") return loadFeedPage("maga");
  }

  function init(){
    mountHeader();
    mountFooter();
    mountCookieBanner();
    wireReactions();
    initRouter();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
