/* =======================
   CivicThreat.us app.js
   ======================= */

(()=>{
  const $ = (sel, root=document)=> root.querySelector(sel);
  const qsa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

  function esc(s){
    return String(s ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#39;");
  }

  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }

  // Root-relative navigation so subfolder pages never break (/released/..., etc.)
  function basePath(){
    // Always use root-relative links so subfolder pages (e.g. /released/...) never 404
    return "/";
  }

  function pageName(){
    return (document.body && document.body.getAttribute("data-page")) || "";
  }

  function isAdminPage(){
    return pageName() === "admin";
  }

  function remoteApi(){
    // data-api.js attaches CT_REMOTE
    if(!window.CT_REMOTE) throw new Error("CT_REMOTE missing (did data-api.js load?)");
    return window.CT_REMOTE;
  }

  async function listApproved(){ return await remoteApi().listApproved(); }
  async function listPending(){ return await remoteApi().listPending(); }
  async function submitItem(item){ return await remoteApi().submit(item); }
  async function approveItem(id){ return await remoteApi().approve(id); }
  async function rejectItem(id){ return await remoteApi().reject(id); }
  async function reactItem(id, kind){ return await remoteApi().react(id, kind); }

  // ---------- Header/Footer mounting ----------
  async function mountHeader(){
    const host = $("#siteHeader");
    if(!host) return;

    const bp = basePath();

    host.innerHTML = `
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${bp}index.html" aria-label="Civic Threat home">
      <img src="${bp}assets/logo.png" class="logo" alt="Civic Threat"/>
      <div class="brand-text">
        <div class="brand-title">CIVIC THREAT</div>
        <div class="brand-sub">Debate &amp; Discuss</div>
      </div>
    </a>

    <div class="header-social">
      <span class="follow">FOLLOW US</span>
      <a class="soc" href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener" aria-label="Facebook">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.88 3.77-3.88 1.09 0 2.23.2 2.23.2v2.46h-1.25c-1.23 0-1.61.76-1.61 1.54V12h2.74l-.44 2.89h-2.3v6.99A10 10 0 0 0 22 12z"/></svg>
      </a>
      <a class="soc" href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener" aria-label="YouTube">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2s-.2-1.5-.8-2.1c-.8-.8-1.7-.8-2.1-.9C15.8 4 12 4 12 4h0s-3.8 0-6.7.2c-.4.1-1.3.1-2.1.9-.6.6-.8 2.1-.8 2.1S2 8.9 2 10.6v1.6c0 1.7.4 3.4.4 3.4s.2 1.5.8 2.1c.8.8 1.9.8 2.4.9 1.7.2 6.4.2 6.4.2s3.8 0 6.7-.2c.4-.1 1.3-.1 2.1-.9.6-.6.8-2.1.8-2.1s.4-1.7.4-3.4v-1.6c0-1.7-.4-3.4-.4-3.4zM10 14.9V8.9l6 3-6 3z"/></svg>
      </a>
      <a class="soc" href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener" aria-label="TikTok">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.7 3c.3 2.2 1.6 3.6 3.8 3.8V9c-1.5 0-2.9-.5-4-1.4v7.2c0 3.2-2.6 5.8-5.8 5.8S5 18 5 14.8s2.6-5.8 5.8-5.8c.5 0 1 .1 1.5.2v2.6c-.5-.2-1-.3-1.5-.3-1.8 0-3.3 1.5-3.3 3.3s1.5 3.3 3.3 3.3 3.3-1.5 3.3-3.3V3h2.4z"/></svg>
      </a>
      <a class="soc" href="https://x.com/CivicThreat" target="_blank" rel="noopener" aria-label="X">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.9l-5.4-6.7L4.9 22H2l7.3-8.4L1 2h7l4.9 6.1L18.9 2zm-1.2 18h1.7L7.2 3.9H5.4L17.7 20z"/></svg>
      </a>
    </div>

    <nav class="header-nav">
      <div class="dropdown" data-dd="platforms">
        <button class="dd-btn" type="button">Platforms ▾</button>
        <div class="dd-menu">
          <a href="${bp}facebook.html">Facebook • Support</a>
          <a href="${bp}facebook-maga.html">Facebook • MAGA / Debate</a>
        </div>
      </div>

      <div class="dropdown" data-dd="released">
        <button class="dd-btn" type="button">Released Files ▾</button>
        <div class="dd-menu">
          <a href="${bp}released/epstein/epstein-reader.html">Epstein Files</a>
        </div>
      </div>

      <a class="btn blue" href="${bp}submit.html">Submit</a>
    </nav>
  </div>
</header>
`;
    // dropdown toggles
    qsa(".dropdown .dd-btn", host).forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        const dd = btn.closest(".dropdown");
        const open = dd.classList.contains("open");
        qsa(".dropdown.open", host).forEach(x=> x.classList.remove("open"));
        if(!open) dd.classList.add("open");
        e.stopPropagation();
      });
    });
    document.addEventListener("click", ()=> qsa(".dropdown.open", host).forEach(x=> x.classList.remove("open")));
  }

  async function mountFooter(){
    const host = $("#siteFooter");
    if(!host) return;

    const year = new Date().getFullYear();
    host.innerHTML = `
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="foot-left">
      <div class="foot-title">Civic Threat</div>
      <div class="foot-sub">Transparency • Public Records • Civil Discussion</div>
      <div class="foot-links">
        <a href="${basePath()}about.html">About</a>
        <a href="${basePath()}contact.html">Contact</a>
        <a href="${basePath()}policy/privacy">Privacy</a>
        <a href="${basePath()}policy/terms">Terms</a>
      </div>
    </div>

    <div class="foot-right">
      <div class="foot-social">
        <a href="https://www.facebook.com/CivicThreat/" target="_blank" rel="noopener">Facebook</a>
        <a href="https://www.youtube.com/@civicthreat" target="_blank" rel="noopener">YouTube</a>
        <a href="https://www.tiktok.com/@civicthreat" target="_blank" rel="noopener">TikTok</a>
        <a href="https://x.com/CivicThreat" target="_blank" rel="noopener">X</a>
      </div>
      <div class="foot-copy">© ${year} Civic Threat. All rights reserved.</div>
    </div>
  </div>
</footer>
`;
  }

  // ---------- Cookie banner ----------
  function mountCookieBanner(){
    // very lightweight banner; safe for your "cover our butt" goal
    if(localStorage.getItem("ct_cookie_ok") === "1") return;

    const bar = document.createElement("div");
    bar.className = "cookiebar";
    bar.innerHTML = `
      <div class="cookiebar-inner">
        <div class="cookiebar-text">
          We use cookies and similar technologies for site functionality and analytics. By using this site, you agree to our use of cookies.
          <a href="${basePath()}policy/privacy">Learn more</a>
        </div>
        <button class="btn small" type="button" id="cookieOk">OK</button>
      </div>
    `;
    document.body.appendChild(bar);
    on($("#cookieOk", bar), "click", ()=>{
      localStorage.setItem("ct_cookie_ok","1");
      bar.remove();
    });
  }

  // ---------- Reactions (Support ❤️ / MAGA 🖕) ----------
  function initReactions(){
    const COOLDOWN_MS = 5000;

    function setCooldown_(btn, ms){
      if(!btn) return;
      btn.disabled = true;
      btn.classList.add("cooldown");
      window.setTimeout(()=>{
        btn.disabled = false;
        btn.classList.remove("cooldown");
      }, Math.max(0, ms));
    }

    function updateCounts_(id, up, down){
      const safeId = String(id||"");
      // Update any instances of the count on the page (home grids, list pages, etc.)
      qsa(`.reactcount[data-react-count="${safeId}"][data-react-kind="up"]`).forEach(el=> el.textContent = String(up));
      qsa(`.reactcount[data-react-count="${safeId}"][data-react-kind="down"]`).forEach(el=> el.textContent = String(down));
    }

    document.addEventListener("click", async (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest(".reactbtn") : null;
      if(!btn) return;

      const id = (btn.getAttribute("data-react-id") || "").trim();
      const kind = (btn.getAttribute("data-react-kind") || "").trim().toLowerCase();
      if(!id || (kind !== "up" && kind !== "down")) return;

      // Per-browser cooldown (requested: 1 click every 5 seconds)
      const cdKey = `ct_react_cd_${id}_${kind}`;
      const now = Date.now();
      let last = 0;
      try { last = Number(localStorage.getItem(cdKey) || 0); } catch(_){}
      const delta = now - last;
      if(delta < COOLDOWN_MS){
        setCooldown_(btn, COOLDOWN_MS - delta);
        return;
      }

      const original = btn.textContent;
      btn.textContent = "…";
      btn.disabled = true;

      try {
        const res = await reactItem(id, kind); // calls Apps Script
        if(res && res.ok){
          updateCounts_(id, res.reactionsUp, res.reactionsDown);
          try { localStorage.setItem(cdKey, String(now)); } catch(_){}
          setCooldown_(btn, COOLDOWN_MS);
        } else {
          // if backend says no, just unlock immediately
          btn.disabled = false;
        }
      } catch (err) {
        console.error("reaction failed", err);
        btn.disabled = false;
      } finally {
        btn.textContent = original;
      }
    });
  }

  // ---------- Facebook embed parsing ----------
  function normalizeFbUrl(url){
    const u = String(url||"").trim();
    if(!u) return "";
    // accept embed code or url
    const m = u.match(/https?:\/\/www\.facebook\.com\/[^\s"'<>]+/i);
    return m ? m[0] : u;
  }

  function makeEmbedHtml(postUrl){
    const u = normalizeFbUrl(postUrl);
    if(!u) return "";
    // Use Facebook plugin iframe embed (lighter than SDK)
    // NOTE: The site already has a moderation layer; embeds may still load external content.
    const href = encodeURIComponent(u);
    const src = `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=500`;
    return `
      <div class="fb-embed">
        <iframe
          src="${src}"
          width="500"
          height="680"
          style="border:none;overflow:hidden"
          scrolling="no"
          frameborder="0"
          allowfullscreen="true"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share">
        </iframe>
      </div>
    `;
  }

  function renderPostCard(item){
    const title = esc(item.title || "");
    const url = item.postUrl || "";
    const embed = makeEmbedHtml(url);

    const metaBits = [];
    if(item.submitterName) metaBits.push(`Submitted by <b>${esc(item.submitterName)}</b>`);
    if(item.submittedAt) metaBits.push(`Submitted <b>${new Date(Number(item.submittedAt)).toLocaleString()}</b>`);
    if(item.approvedAt) metaBits.push(`Approved <b>${new Date(Number(item.approvedAt)).toLocaleString()}</b>`);
    const meta = metaBits.length ? metaBits.join(" • ") : "";

    const goTo = url
      ? `<a class="btn blue" href="${esc(url)}" target="_blank" rel="noopener">Go to Post</a>`
      : ``;

    const upCount = Number(item.reactionsUp || 0);
    const downCount = Number(item.reactionsDown || 0);
    const react = (item.category === "support")
      ? `<button class="reactbtn" type="button" data-react-id="${esc(item.id||"")}" data-react-kind="up" aria-label="React (heart)">❤️</button>
         <span class="reactcount" data-react-count="${esc(item.id||"")}" data-react-kind="up">${upCount}</span>`
      : `<button class="reactbtn" type="button" data-react-id="${esc(item.id||"")}" data-react-kind="down" aria-label="React (middle finger)">🖕</button>
         <span class="reactcount" data-react-count="${esc(item.id||"")}" data-react-kind="down">${downCount}</span>`;

    return `
      <article class="post-card" data-id="${esc(item.id||"")}">
        <div class="post-head">
          <div class="post-title">${title}</div>
          <div class="post-tag ${item.category === "support" ? "tag-support" : "tag-maga"}">
            ${item.category === "support" ? "SUPPORT" : "MAGA / DEBATE"}
          </div>
        </div>

        ${meta ? `<div class="post-meta">${meta}</div>` : ``}

        ${embed}

        <div class="post-actions">
          <div class="btn-row">
            ${goTo}
            <div class="reactwrap" aria-label="Reactions">${react}</div>
            <a class="btn" href="${item.category === "support" ? (basePath()+'facebook.html') : (basePath()+'facebook-maga.html')}">Browse</a>
          </div>
        </div>
      </article>
    `;
  }

  // ---------- Pages ----------
  async function loadHome(){
    const supportHost = $("#homeSupport");
    const magaHost = $("#homeMaga");
    if(!supportHost && !magaHost) return;

    try{
      const res = await listApproved();
      const items = (res && res.items) ? res.items : [];
      const support = items.filter(x=> x.category === "support").slice(0, 4);
      const maga = items.filter(x=> x.category === "maga").slice(0, 4);

      if(supportHost) supportHost.innerHTML = support.map(renderPostCard).join("") || `<div class="empty">No approved posts yet.</div>`;
      if(magaHost) magaHost.innerHTML = maga.map(renderPostCard).join("") || `<div class="empty">No approved posts yet.</div>`;
    } catch(err){
      console.error(err);
      if(supportHost) supportHost.innerHTML = `<div class="empty">Unable to load posts.</div>`;
      if(magaHost) magaHost.innerHTML = `<div class="empty">Unable to load posts.</div>`;
    }
  }

  async function loadFacebookList(kind){
    const host = $("#feed");
    if(!host) return;

    try{
      const res = await listApproved();
      const items = (res && res.items) ? res.items : [];
      const list = items.filter(x=> x.category === kind);
      host.innerHTML = list.map(renderPostCard).join("") || `<div class="empty">No posts yet.</div>`;
    } catch(err){
      console.error(err);
      host.innerHTML = `<div class="empty">Unable to load posts.</div>`;
    }
  }

  async function loadSubmit(){
    const form = $("#submitForm");
    if(!form) return;

    const titleEl = $("#title");
    const urlEl = $("#postUrl");
    const nameEl = $("#submitterName");
    const linkEl = $("#submitterLink");
    const consentEl = $("#consent");
    const catEl = $("#category");
    const statusEl = $("#submitStatus");

    on(form, "submit", async (e)=>{
      e.preventDefault();
      if(statusEl) statusEl.textContent = "Submitting…";

      const item = {
        platform: "facebook",
        category: (catEl && catEl.value) ? catEl.value : "support",
        title: (titleEl && titleEl.value) ? titleEl.value.trim() : "",
        postUrl: (urlEl && urlEl.value) ? urlEl.value.trim() : "",
        submitterName: (nameEl && nameEl.value) ? nameEl.value.trim() : "Anonymous",
        submitterLink: (linkEl && linkEl.value) ? linkEl.value.trim() : "",
        consent: !!(consentEl && consentEl.checked)
      };

      try{
        const res = await submitItem(item);
        if(res && res.ok){
          if(statusEl) statusEl.textContent = "Submitted! It will appear after review.";
          form.reset();
        } else {
          if(statusEl) statusEl.textContent = "Submit failed.";
        }
      } catch(err){
        console.error(err);
        if(statusEl) statusEl.textContent = "Submit failed.";
      }
    });
  }

  async function loadAdmin(){
    const pendHost = $("#pendingList");
    if(!pendHost) return;

    try{
      const res = await listPending();
      const items = (res && res.items) ? res.items : [];
      if(!items.length){
        pendHost.innerHTML = `<div class="empty">No pending items.</div>`;
        return;
      }

      pendHost.innerHTML = items.map(item=>{
        return `
          <article class="post-card" data-id="${esc(item.id||"")}">
            <div class="post-head">
              <div class="post-title">${esc(item.title||"")}</div>
              <div class="post-tag ${item.category === "support" ? "tag-support" : "tag-maga"}">
                ${item.category === "support" ? "SUPPORT" : "MAGA / DEBATE"}
              </div>
            </div>

            <div class="post-meta">
              Submitted by <b>${esc(item.submitterName||"Anonymous")}</b>
              ${item.submittedAt ? ` • ${new Date(Number(item.submittedAt)).toLocaleString()}` : ``}
            </div>

            ${makeEmbedHtml(item.postUrl)}

            <div class="post-actions">
              <div class="btn-row">
                <button class="btn green admin-approve" type="button" data-id="${esc(item.id||"")}">Approve</button>
                <button class="btn red admin-reject" type="button" data-id="${esc(item.id||"")}">Reject</button>
                ${item.postUrl ? `<a class="btn" href="${esc(item.postUrl)}" target="_blank" rel="noopener">Open</a>` : ``}
              </div>
            </div>
          </article>
        `;
      }).join("");

      // Approve/reject handlers
      pendHost.addEventListener("click", async (e)=>{
        const btn = e.target.closest("button");
        if(!btn) return;

        const id = btn.getAttribute("data-id");
        if(!id) return;

        if(btn.classList.contains("admin-approve")){
          btn.disabled = true;
          try{
            const res = await approveItem(id);
            if(res && res.ok){
              btn.closest(".post-card")?.remove();
            } else {
              btn.disabled = false;
            }
          } catch(err){
            console.error(err);
            btn.disabled = false;
          }
        }

        if(btn.classList.contains("admin-reject")){
          btn.disabled = true;
          try{
            const res = await rejectItem(id);
            if(res && res.ok){
              btn.closest(".post-card")?.remove();
            } else {
              btn.disabled = false;
            }
          } catch(err){
            console.error(err);
            btn.disabled = false;
          }
        }
      });

    } catch(err){
      console.error(err);
      pendHost.innerHTML = `<div class="empty">Unable to load pending list.</div>`;
    }
  }

  // ---------- Init ----------
  function init(){
    mountHeader();
    mountFooter();
    mountCookieBanner();
    initReactions();

    const p = pageName();
    if(p === "home") loadHome();
    if(p === "facebook") loadFacebookList("support");
    if(p === "facebook-maga") loadFacebookList("maga");
    if(p === "submit") loadSubmit();
    if(p === "admin") loadAdmin();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
